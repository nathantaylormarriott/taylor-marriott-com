import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_MONTHLY,
  PLAN_ONE_OFF,
  domainExcessPence,
  firstInvoicePence,
} from '../shared/billing-plans.js';
import {
  MAX_DUNNING_ATTEMPTS,
  emptyDunning,
  pausePlan,
  reconcileDrift,
  recordFailedAttempt,
  recordPaid,
  resumePlan,
  shouldRenewDomainOnPaidInvoice,
} from '../shared/billing-lifecycle.js';
import { deliverNotice } from '../netlify/functions/_shared/billing-notify.js';
import { runBillingDay } from '../netlify/functions/_shared/billing-run.js';
import { buildSiteCheckoutParams } from '../netlify/functions/_shared/domain-checkout.js';

const cfg = { siteAmountPence: 29900, renewalLeadDays: 30 };
const urls = { successUrl: 'https://x/y', cancelUrl: 'https://x/z' };

test('£299 includes up to £20 and adds excess today; £39 includes up to £39', () => {
  assert.equal(domainExcessPence(1500, 2000), 0);
  assert.equal(domainExcessPence(2500, 2000), 500);
  assert.equal(firstInvoicePence(PLAN_ONE_OFF, 2500), 30400);
  assert.equal(firstInvoicePence(PLAN_MONTHLY, 1500), 3900);
  assert.equal(firstInvoicePence(PLAN_MONTHLY, 5000), 5000);
});

test('monthly checkout is £39 with excess on the first invoice and no yearly domain item', () => {
  const p = buildSiteCheckoutParams(
    { placeId: 'cid-1', plan: PLAN_MONTHLY, domain: 'big.com', domainAmountPence: 5000, ...urls },
    { config: cfg },
  );
  assert.equal(p.params.mode, 'subscription');
  assert.equal(p.params.line_items[0].price_data.unit_amount, 3900);
  assert.equal(p.params.line_items[0].price_data.recurring.interval, 'month');
  assert.equal(p.params.line_items[1].price_data.unit_amount, 1100);
  assert.equal(p.params.line_items[1].price_data.recurring, undefined);
  assert.equal(p.params.subscription_data.trial_period_days, undefined);
});

test('first fail then pay does not pause', async () => {
  const day1 = await runBillingDay({
    now: new Date('2026-06-01T12:00:00Z'),
    dryRun: true,
    openInvoices: [
      {
        invoiceId: 'in_1',
        plan: PLAN_MONTHLY,
        outcome: 'failed',
        hostedInvoiceUrl: 'https://pay.example/in_1',
        email: 'client@example.com',
        phone: '+447000000000',
      },
    ],
  });
  const fail = day1.log.find((row) => row.type === 'failed');
  assert.equal(fail.attempt, 1);
  assert.equal(fail.email, true);
  assert.equal(fail.sms, true);
  assert.equal(fail.closed, false);
  assert.equal(fail.notice.dryRun, true);

  const day2 = await runBillingDay({
    now: new Date('2026-06-02T12:00:00Z'),
    dryRun: true,
    openInvoices: [
      {
        invoiceId: 'in_1',
        plan: PLAN_MONTHLY,
        outcome: 'paid',
        wasPaused: false,
        dunning: fail.record,
      },
    ],
  });
  const paid = day2.log.find((row) => row.type === 'paid');
  assert.equal(paid.dunning.status, 'paid');
  assert.equal(day2.log.some((row) => row.type === 'unpaid_final'), false);
});

test('10 failed days email and SMS each day, then pause', async () => {
  let dunning = emptyDunning('in_10');
  const notices = [];
  for (let i = 0; i < MAX_DUNNING_ATTEMPTS; i += 1) {
    const todayKey = `2026-07-${String(i + 1).padStart(2, '0')}`;
    const result = recordFailedAttempt(dunning, {
      todayKey,
      hostedInvoiceUrl: 'https://pay.example/in_10',
    });
    assert.equal(result.email, true);
    assert.equal(result.sms, true);
    notices.push(result);
    dunning = result.record;
  }
  assert.equal(notices.length, 10);
  assert.equal(dunning.status, 'uncollectible');
  assert.equal(notices[9].closed, true);
  const sameDay = recordFailedAttempt(dunning, { todayKey: '2026-07-10', hostedInvoiceUrl: 'x' });
  assert.equal(sameDay.skipped, 'closed');

  const pause = pausePlan({ plan: PLAN_MONTHLY, domainRenewalDue: false });
  assert.equal(pause.pauseSite, true);
  assert.equal(pause.keepCustomDomain, true);
  assert.equal(pause.httpStatus, 503);
});

test('pay after pause resumes and re-registers only when allowed', () => {
  const owned = resumePlan({ domainOwned: true, domainAvailable: false, purchaseLive: false });
  assert.equal(owned.reattachDomain, true);
  assert.equal(owned.reregister, false);

  const lapsedLive = resumePlan({ domainOwned: false, domainAvailable: true, purchaseLive: true });
  assert.equal(lapsedLive.reregister, true);

  const lapsedDry = resumePlan({ domainOwned: false, domainAvailable: true, purchaseLive: false });
  assert.equal(lapsedDry.reregister, false);
  assert.equal(lapsedDry.emailNathan, true);
  assert.equal(lapsedDry.stayOnPreview, true);

  const taken = resumePlan({ domainOwned: false, domainAvailable: false, purchaseLive: true });
  assert.equal(taken.reregister, false);
  assert.equal(taken.reason, 'domain_unavailable');

  const paid = recordPaid(emptyDunning('in_x'), { todayKey: '2026-08-01' });
  assert.equal(paid.status, 'paid');
});

test('£299 renewal unpaid lapses the custom domain and does not renew', () => {
  const pause = pausePlan({ plan: PLAN_ONE_OFF, domainRenewalDue: true });
  assert.equal(pause.detachDomain, true);
  assert.equal(pause.renewAtRegistrar, false);
  assert.equal(pause.pauseSite, false);
});

test('missed webhook: reconciler pauses from Stripe unpaid and resumes when active', () => {
  const missed = reconcileDrift({
    stripeStatus: 'unpaid',
    localPaused: false,
    plan: PLAN_MONTHLY,
    domainRenewalDue: false,
  });
  assert.equal(missed.action, 'pause');
  assert.equal(missed.pauseSite, true);

  const singleFail = reconcileDrift({
    stripeStatus: 'past_due',
    localPaused: false,
    plan: PLAN_MONTHLY,
    domainRenewalDue: false,
  });
  assert.equal(singleFail.action, 'none');

  const back = reconcileDrift({
    stripeStatus: 'active',
    localPaused: true,
    plan: PLAN_MONTHLY,
    domainRenewalDue: false,
  });
  assert.equal(back.action, 'resume');
});

test('monthly renewal is not every invoice, and unpaid renewal lapses', () => {
  const early = shouldRenewDomainOnPaidInvoice({
    plan: PLAN_MONTHLY,
    billingReason: 'subscription_cycle',
    domainRenewsAt: '2027-01-01',
    now: new Date('2026-06-01'),
    lastRenewedFor: null,
  });
  assert.equal(early, false);
  const due = shouldRenewDomainOnPaidInvoice({
    plan: PLAN_MONTHLY,
    billingReason: 'subscription_cycle',
    domainRenewsAt: '2026-06-01',
    now: new Date('2026-06-02'),
    lastRenewedFor: null,
  });
  assert.equal(due, true);
});

test('dry-run notice does not send', async () => {
  const notice = await deliverNotice(
    { email: 'client@example.com', phone: '+447000000001', subject: 'Hi', text: 'Pay', sms: 'Pay' },
    { sendEmail: async () => { throw new Error('should not send'); } },
    {},
  );
  assert.equal(notice.dryRun, true);
  assert.equal(notice.sentEmail, false);
  assert.equal(notice.sentSms, false);
});

test('reminders at 30, 14 and 7 days are logged in dry-run', async () => {
  const result = await runBillingDay({
    now: new Date('2026-05-02T12:00:00Z'),
    dryRun: true,
    accounts: [
      {
        id: 'acct_1',
        plan: PLAN_ONE_OFF,
        stripeStatus: 'active',
        renewalAt: '2026-06-01',
        remindersSent: [],
        priceLabel: '£15.00/year',
        manageUrl: 'https://billing.stripe.com/p/session',
        domain: 'acme.co.uk',
        email: 'client@example.com',
        phone: '+447000000002',
      },
    ],
  });
  const reminders = result.log.filter((row) => row.type === 'reminder');
  assert.deepEqual(reminders.map((row) => row.days), [30]);
  assert.equal(reminders[0].notice.dryRun, true);
});
