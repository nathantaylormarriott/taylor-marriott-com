import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { emptyDunning, pausePlan } from '../shared/billing-lifecycle.js';
import { PLAN_MONTHLY, PLAN_ONE_OFF } from '../shared/billing-plans.js';
import { runBillingDay } from '../netlify/functions/_shared/billing-run.js';
import { reconcileBillingPages } from '../netlify/functions/_shared/billing-reconcile.js';
import { paymentFailedFromEvent } from '../netlify/functions/_shared/billing-events.js';
import { listSiteCheckoutPage, payInvoice } from '../netlify/functions/_shared/billing-stripe.js';
import { applySiteChange } from '../netlify/functions/_shared/billing-actions.js';
import { buildRawEmail } from '../netlify/functions/_shared/billing-gmail.js';
import { memoryStore, setBillingStoresForTests } from '../netlify/functions/_shared/billing-store.js';

function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
  return { t, sig };
}

test('10 failed billing days send email and SMS every day, then pause', async () => {
  let dunning = emptyDunning('in_ops');
  const pauses = [];
  let last;
  for (let i = 0; i < 10; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    last = await runBillingDay({
      now: new Date(`2026-09-${day}T11:00:00Z`),
      dryRun: true,
      openInvoices: [
        {
          invoiceId: 'in_ops',
          plan: PLAN_MONTHLY,
          outcome: 'failed',
          email: 'client@example.com',
          phone: '+447000000010',
          hostedInvoiceUrl: 'https://pay.example/in_ops',
          dunning,
          domainRenewalDue: false,
        },
      ],
      onPause: async (row) => {
        pauses.push(row.pause);
      },
    });
    const fail = last.log.find((row) => row.type === 'failed');
    assert.equal(fail.email, true);
    assert.equal(fail.sms, true);
    assert.equal(fail.attempt, i + 1);
    assert.match(fail.notice.text, /Pay here: https:\/\/pay\.example\/in_ops/);
    assert.match(fail.notice.sms, /https:\/\/taylor-marriott.com\/p\/dryrun01/);
    assert.ok(fail.notice.sms.length <= 159);
    assert.equal(fail.notice.dryRun, true);
    assert.equal(fail.notice.sentSms, false);
    dunning = fail.record;
  }
  assert.equal(dunning.status, 'uncollectible');
  assert.equal(dunning.notifications.length, 10);
  assert.equal(last.log.some((row) => row.type === 'unpaid_final'), true);
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].pauseSite, true);
  assert.equal(pauses[0].keepCustomDomain, true);

  const again = await runBillingDay({
    now: new Date('2026-09-10T15:00:00Z'),
    dryRun: true,
    openInvoices: [{ invoiceId: 'in_ops', plan: PLAN_MONTHLY, outcome: 'failed', dunning }],
  });
  assert.equal(again.log.some((row) => row.type === 'failed'), false);
  assert.equal(again.log[0].type, 'skip');
});

test('dry-run does not charge or record a failure when no outcome is injected', async () => {
  let charged = 0;
  const result = await runBillingDay({
    now: new Date('2026-04-01T12:00:00Z'),
    dryRun: true,
    stripe: {
      payInvoice: async () => {
        charged += 1;
        return { paid: true };
      },
    },
    openInvoices: [{ invoiceId: 'in_dry', plan: PLAN_ONE_OFF, email: 'c@example.com' }],
  });
  assert.equal(charged, 0);
  assert.equal(result.log[0].type, 'dry_run_skip');
  assert.equal(result.log.some((row) => row.type === 'failed'), false);
});

test('paginated reconcile fixes a missed unpaid webhook and leaves past_due alone', async () => {
  const pages = [
    {
      subscriptions: [
        {
          object: 'subscription',
          id: 'sub_due',
          status: 'past_due',
          start_date: 1_700_000_000,
          metadata: { product_type: 'site_checkout', plan: 'monthly', domain: 'due.co.uk', place_id: 'p1', phone: '+447000000001' },
          customer: { object: 'customer', id: 'cus_due', email: 'due@example.com' },
          latest_invoice: { object: 'invoice', id: 'in_due', status: 'open', hosted_invoice_url: 'https://pay.example/in_due' },
        },
      ],
      hasMore: true,
      nextPage: 'page-2',
    },
    {
      subscriptions: [
        {
          object: 'subscription',
          id: 'sub_unpaid',
          status: 'unpaid',
          start_date: 1_700_000_000,
          metadata: { product_type: 'site_checkout', plan: 'one_off', domain: 'lapse.co.uk', place_id: 'p2' },
          customer: { object: 'customer', id: 'cus_unpaid', email: 'lapse@example.com' },
          latest_invoice: { object: 'invoice', id: 'in_old', status: 'uncollectible' },
        },
      ],
      hasMore: false,
      nextPage: null,
    },
  ];
  let cursor = 0;
  const pauses = [];
  const result = await reconcileBillingPages({
    now: new Date('2026-08-01T12:00:00Z'),
    dryRun: true,
    maxPages: 5,
    listPage: async ({ page }) => {
      const row = pages[cursor];
      cursor += 1;
      if (cursor === 2) assert.equal(page, 'page-2');
      return row;
    },
    onPause: async (row) => {
      pauses.push(row);
    },
  });
  assert.equal(result.done, true);
  assert.equal(result.pages, 2);
  assert.equal(result.log.some((row) => row.type === 'dry_run_skip' && row.invoiceId === 'in_due'), true);
  assert.equal(result.log.some((row) => row.type === 'failed'), false);
  const pause = result.log.find((row) => row.type === 'reconcile_pause' && row.accountId === 'sub_unpaid');
  assert.equal(pause.detachDomain, true);
  assert.equal(pause.pauseSite, false);
  assert.equal(pause.renewAtRegistrar, false);
  assert.equal(pauses.length, 1);
});

test('pay after pause resumes an owned domain and refuses a taken one', async () => {
  const resumes = [];
  const paid = await runBillingDay({
    now: new Date('2026-08-02T12:00:00Z'),
    dryRun: true,
    openInvoices: [
      {
        invoiceId: 'in_back',
        plan: PLAN_MONTHLY,
        outcome: 'paid',
        wasPaused: true,
        resume: { domainOwned: true, domainAvailable: false, purchaseLive: false },
      },
    ],
    onResume: async (row) => {
      resumes.push(row.resume);
    },
  });
  assert.equal(paid.log.find((row) => row.type === 'paid').resume.reattachDomain, true);
  assert.equal(resumes[0].reregister, false);

  const lapsed = await runBillingDay({
    now: new Date('2026-08-03T12:00:00Z'),
    dryRun: true,
    accounts: [
      {
        id: 'sub_back',
        plan: PLAN_MONTHLY,
        stripeStatus: 'active',
        localPaused: true,
        resume: { domainOwned: false, domainAvailable: false, purchaseLive: true },
      },
    ],
  });
  const resume = lapsed.log.find((row) => row.type === 'reconcile_resume');
  assert.equal(resume.resume.reregister, false);
  assert.equal(resume.resume.stayOnPreview, true);
  assert.equal(resume.resume.emailNathan, true);
});

test('payment_failed is recorded and a single event does not pause', () => {
  const info = paymentFailedFromEvent({
    id: 'evt_pf',
    type: 'invoice.payment_failed',
    data: {
      object: {
        object: 'invoice',
        id: 'in_pf',
        subscription: 'sub_pf',
        subscription_details: { metadata: { product_type: 'site_checkout', plan: 'monthly', domain: 'a.co.uk' } },
      },
    },
  });
  assert.equal(info.pause, false);
  assert.equal(info.invoiceId, 'in_pf');
});

test('webhook payment_failed stores the open invoice without a dunning attempt', async () => {
  const accounts = memoryStore();
  const dunning = memoryStore();
  setBillingStoresForTests({ accounts, dunning, events: memoryStore() });
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_test_only';
  const { default: webhook } = await import('../netlify/functions/stripe-webhook.js');
  const body = JSON.stringify({
    id: 'evt_pf_hook',
    type: 'invoice.payment_failed',
    data: {
      object: {
        object: 'invoice',
        id: 'in_hook',
        customer_email: 'c@example.com',
        hosted_invoice_url: 'https://pay.example/in_hook',
        subscription: 'sub_hook',
        subscription_details: {
          metadata: { product_type: 'site_checkout', plan: 'monthly', domain: 'hook.co.uk', phone: '+447000000099' },
        },
      },
    },
  });
  const { t, sig } = sign(body);
  const res = await webhook(
    new Request('https://example.test/api/stripe-webhook', {
      method: 'POST',
      body,
      headers: { 'stripe-signature': `t=${t},v1=${sig}` },
    }),
  );
  const payload = await res.json();
  assert.equal(res.status, 200);
  assert.equal(payload.paused, false);
  assert.equal(payload.recorded, 'in_hook');
  const saved = await dunning.get('in_hook', { type: 'json' });
  assert.equal(saved.attemptCount, 0);
  const account = await accounts.get('sub_hook', { type: 'json' });
  assert.equal(account.stripeStatus, 'past_due');
  assert.equal(account.localPaused, false);
  assert.equal(account.phone, '+447000000099');
});

test('pause switch dry-run writes nothing and live writes the blob once', async () => {
  let writes = 0;
  const decision = pausePlan({ plan: PLAN_MONTHLY, domainRenewalDue: false });
  const dry = await applySiteChange({
    account: { netlifySiteId: 'site-1', domain: 'a.co.uk' },
    decision,
    dryRun: true,
    deps: {
      writePause: async () => {
        writes += 1;
      },
    },
  });
  assert.equal(writes, 0);
  assert.equal(dry.steps.find((step) => step.id === 'pause_switch').blob.paused, true);
  assert.equal(dry.steps.find((step) => step.id === 'registrar_renew').mode, 'skipped');

  const live = await applySiteChange({
    account: { netlifySiteId: 'site-1', domain: 'a.co.uk' },
    decision,
    dryRun: false,
    deps: {
      writePause: async ({ record }) => {
        writes += 1;
        assert.equal(record.paused, true);
      },
    },
  });
  assert.equal(writes, 1);
  assert.equal(live.applied, true);
  assert.equal(live.steps.find((step) => step.id === 'detach_domain'), undefined);
});

test('stripe list retries a 500 and a card decline is a failed attempt, not a throw', async () => {
  let calls = 0;
  const listed = await listSiteCheckoutPage({
    key: 'sk_test_unit',
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 500 });
      return new Response(JSON.stringify({ data: [{ object: 'subscription', id: 'sub_x' }], has_more: false }), { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(listed.subscriptions.length, 1);

  const declined = await payInvoice('in_card', {
    key: 'sk_test_unit',
    todayKey: '2026-01-02',
    fetchImpl: async (url, init) => {
      assert.match(url, /\/invoices\/in_card\/pay$/);
      assert.equal(init.headers['Idempotency-Key'], 'tm-pay-in_card-2026-01-02');
      return new Response(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', message: 'no' } }), {
        status: 402,
      });
    },
  });
  assert.equal(declined.paid, false);
  assert.equal(declined.error, 'card_declined');
});

test('gmail raw message is addressed to the recipient and is not sent', () => {
  const raw = buildRawEmail({
    from: 'nathan@taylor-marriott.com',
    to: 'nathan@taylor-marriott.com',
    subject: 'Domain renewal in 30 days',
    text: 'Manage or update your card: https://billing.stripe.com/p/session',
  });
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(text, /From: nathan@taylor-marriott.com/);
  assert.match(text, /To: nathan@taylor-marriott.com/);
  assert.doesNotMatch(text, /—/);
});

test('paused page edge template keeps the real site unless the switch is on', () => {
  const src = fs.readFileSync(new URL('../templates/client-site-pause/netlify/edge-functions/site-pause.js', import.meta.url), 'utf8');
  assert.match(src, /context\.next\(\)/);
  assert.match(src, /status: 503/);
  assert.match(src, /Retry-After': '86400'/);
  assert.match(src, /tel:\+447831798112/);
  assert.match(src, /https:\/\/wa\.me\/447831798112/);
  assert.match(src, /Contact Taylor-Marriott to resume your service/);
  assert.match(src, /mailto:nathan@taylor-marriott.com/);
  assert.doesNotMatch(src, /—/);
});

test('live billing actions refuse to run without a cron secret', async () => {
  const previous = process.env.BILLING_ACTIONS_LIVE;
  process.env.BILLING_ACTIONS_LIVE = '1';
  delete process.env.BILLING_CRON_SECRET;
  try {
    const { default: handler } = await import('../netlify/functions/billing-daily-background.js');
    const res = await handler(
      new Request('https://example.test/api/billing-daily', {
        method: 'POST',
        body: JSON.stringify({ openInvoices: [], accounts: [] }),
      }),
    );
    assert.equal(res.status, 403);
  } finally {
    if (previous == null) delete process.env.BILLING_ACTIONS_LIVE;
    else process.env.BILLING_ACTIONS_LIVE = previous;
  }
});
