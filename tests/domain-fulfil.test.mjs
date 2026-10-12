// node --test tests/  (no network: Porkbun, Netlify and the background trigger are mocked)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fulfilDomainOrder, orderFromEvent } from '../netlify/functions/_shared/domain-fulfil.js';
import { buildSiteCheckoutParams } from '../netlify/functions/_shared/domain-checkout.js';
import { conflictingDnsRecords, netlifyDnsRecords } from '../netlify/functions/_shared/porkbun-client.js';
import { _linksToPlace } from '../netlify/functions/_shared/netlify-sites.js';
import { setOrdersStoreForTests, memoryStore } from '../netlify/functions/_shared/domainOrders.js';
import { renewalFromInvoiceEvent, fulfilDomainRenewal, subscriptionDeletedFromEvent } from '../netlify/functions/_shared/domain-renew.js';
import { setRenewalsStoreForTests, memoryRenewalsStore } from '../netlify/functions/_shared/domainRenewals.js';
import { setSubscriptionStoreForTests, memorySubscriptionStore } from '../netlify/functions/_shared/domainSubscriptions.js';
import { memoryStore as billingMemoryStore, setBillingStoresForTests } from '../netlify/functions/_shared/billing-store.js';
import { fixedYearlyPenceForDomain, loadDomainPricingConfig, assertPorkbunWithinClientPrice } from '../netlify/functions/_shared/domain-pricing.js';

const SITE = { siteId: 'site-1', siteName: 'tmbulk-acme', customDomain: null, domainAliases: [], source: 'registry' };

function event({ livemode = false, domain = 'acmebuilders.co.uk', amount = '448', paid = 'paid' } = {}) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    livemode,
    data: {
      object: {
        object: 'checkout.session',
        id: livemode ? 'cs_live_abc' : 'cs_test_abc',
        livemode,
        payment_status: paid,
        client_reference_id: 'cid-1',
        metadata: { product_type: 'site_checkout', place_id: 'cid-1', domain, domain_amount_pence: amount },
      },
    },
  };
}

function fakes({ available = true, price = '5.66', premium = false } = {}) {
  const calls = [];
  const porkbun = {
    checkDomain: async (d) => (calls.push(['check', d]), { domain: d, available, premium, price }),
    createDomain: async (o) => {
      calls.push(['create', o]);
      if (o.confirmSpend !== true) throw new Error('no confirm');
      return { registered: true, orderId: 1 };
    },
    setAutoRenewOff: async (d) => (calls.push(['autorenew', d]), { autoRenew: false }),
    retrieveDnsRecords: async () => [
      { id: '1', name: 'acmebuilders.co.uk', type: 'ALIAS', content: 'pixie.porkbun.com' },
      { id: '2', name: '*.acmebuilders.co.uk', type: 'CNAME', content: 'pixie.porkbun.com' },
      { id: '3', name: 'acmebuilders.co.uk', type: 'MX', content: 'mx.example' },
    ],
    deleteDnsRecord: async (d, id) => (calls.push(['dnsdel', id]), { id }),
    createDnsRecord: async (d, r) => (calls.push(['dnscreate', r.type, r.name, r.content]), r),
  };
  const netlify = {
    resolveClientSite: async () => (calls.push(['resolve']), SITE),
    resolveSiteForOrder: async (order) => {
      calls.push(['resolveSiteForOrder', order.netlifySiteId || null]);
      return SITE;
    },
    netlifyApi: async (p, o) => (calls.push(['netlify', o.method, p, o.body]), { custom_domain: 'acmebuilders.co.uk' }),
  };
  return { calls, deps: { porkbun, netlify } };
}

test('orderFromEvent ignores website-only and unpaid sessions', () => {
  assert.equal(orderFromEvent(event({ domain: '' })), null);
  assert.equal(orderFromEvent(event({ paid: 'unpaid' })), null);
  assert.equal(orderFromEvent({ type: 'invoice.paid' }), null);
  const o = orderFromEvent(event());
  assert.equal(o.domain, 'acmebuilders.co.uk');
  assert.equal(o.domainAmountPence, 448);
  assert.equal(o.livemode, false);
});

test('switches off: nothing spent, nothing changed, full plan recorded', async () => {
  const { calls, deps } = fakes();
  const r = await fulfilDomainOrder(orderFromEvent(event({ livemode: true })), { usdToGbp: 0.79, deps });
  assert.equal(r.status, 'dry_run');
  assert.ok(!calls.some((c) => ['create', 'autorenew', 'dnsdel', 'dnscreate', 'netlify'].includes(c[0])));
  const reg = r.steps.find((s) => s.id === 'porkbun_register');
  assert.equal(reg.mode, 'dry_run');
  assert.equal(reg.request.body.cost, 566);
  assert.equal(reg.request.headers['Idempotency-Key'], 'tm-domain-cs_live_abc');
  assert.equal(reg.request.body.apikey, '<PORKBUN_API_KEY>');
  assert.equal(r.steps.find((s) => s.id === 'netlify_attach_domain').request.body.custom_domain, 'acmebuilders.co.uk');
});

test('purchase switch on but Stripe test mode: still never registers', async () => {
  const { calls, deps } = fakes();
  const r = await fulfilDomainOrder(orderFromEvent(event({ livemode: false })), {
    purchaseLive: true, connectLive: true, usdToGbp: 0.79, deps,
  });
  assert.equal(r.status, 'dry_run');
  assert.ok(!calls.some((c) => c[0] === 'create'));
  assert.match(r.steps.find((s) => s.id === 'porkbun_register').reason, /test-mode/);
});

test('both switches on + live payment: register, auto-renew off, DNS, Netlify attach', async () => {
  const { calls, deps } = fakes();
  const r = await fulfilDomainOrder(orderFromEvent(event({ livemode: true })), {
    purchaseLive: true, connectLive: true, usdToGbp: 0.79, deps,
  });
  assert.equal(r.status, 'connected', JSON.stringify(r.error));
  const create = calls.find((c) => c[0] === 'create')[1];
  assert.equal(create.idempotencyKey, 'tm-domain-cs_live_abc');
  assert.equal(create.costCents, 566);
  assert.deepEqual(calls.filter((c) => c[0] === 'dnsdel').map((c) => c[1]), ['1', '2']); // MX kept
  assert.deepEqual(
    calls.filter((c) => c[0] === 'dnscreate').map((c) => c.slice(1)),
    [['ALIAS', '', 'apex-loadbalancer.netlify.com'], ['CNAME', 'www', 'tmbulk-acme.netlify.app']],
  );
  const patch = calls.find((c) => c[0] === 'netlify' && c[1] === 'PATCH');
  assert.deepEqual(patch[3], { custom_domain: 'acmebuilders.co.uk', domain_aliases: ['www.acmebuilders.co.uk'] });
  assert.ok(calls.some((c) => c[0] === 'netlify' && c[1] === 'POST' && c[2] === '/sites/site-1/ssl'));
});

test('refuses taken, premium, and price jumps above what the client paid', async () => {
  for (const [opt, code] of [
    [{ available: false }, 'NOT_AVAILABLE'],
    [{ premium: true }, 'PREMIUM_REFUSED'],
    [{ price: '9.99' }, 'COST_ABOVE_PAID'], // paid 448p ~ $5.67, +10% tolerance = 623c
  ]) {
    const { calls, deps } = fakes(opt);
    const r = await fulfilDomainOrder(orderFromEvent(event({ livemode: true })), {
      purchaseLive: true, connectLive: true, usdToGbp: 0.79, deps,
    });
    assert.equal(r.status, 'error');
    assert.equal(r.error.code, code);
    assert.ok(!calls.some((c) => c[0] === 'create'));
  }
});

test('fulfilment prefers netlify_site_id metadata over place scan', async () => {
  const { calls, deps } = fakes();
  const order = orderFromEvent(event({ livemode: true }));
  order.netlifySiteId = 'meta-site-uuid';
  await fulfilDomainOrder(order, { usdToGbp: 0.79, deps });
  assert.ok(calls.some((c) => c[0] === 'resolveSiteForOrder' && c[1] === 'meta-site-uuid'));
});

test('retry after a real registration skips registering again', async () => {
  const { calls, deps } = fakes();
  const r = await fulfilDomainOrder(orderFromEvent(event({ livemode: true })), {
    purchaseLive: true, connectLive: true, usdToGbp: 0.79, alreadyRegistered: true, deps,
  });
  assert.equal(r.status, 'connected');
  assert.ok(!calls.some((c) => c[0] === 'create' || c[0] === 'check'));
});

test('refuses a site that already has a different custom domain', async () => {
  const { deps } = fakes();
  deps.netlify.resolveSiteForOrder = async () => ({ ...SITE, customDomain: 'other.com' });
  const r = await fulfilDomainOrder(orderFromEvent(event({ livemode: true })), { purchaseLive: true, usdToGbp: 0.79, deps });
  assert.equal(r.error.code, 'SITE_HAS_OTHER_DOMAIN');
});

test('DNS helpers keep MX/TXT and point at Netlify', () => {
  const recs = [
    { name: 'x.com', type: 'ALIAS' }, { name: 'www.x.com', type: 'CNAME' }, { name: '*.x.com', type: 'CNAME' },
    { name: 'x.com', type: 'MX' }, { name: 'x.com', type: 'TXT' }, { name: 'mail.x.com', type: 'A' },
  ];
  assert.equal(conflictingDnsRecords('x.com', recs).length, 3);
  assert.throws(() => netlifyDnsRecords('example.com'), /netlify\.app/);
});

test('site scan matches only the exact place_id in a checkout link', () => {
  const html = '<a href="https://www.taylor-marriott.com/checkout?place_id=cid-123">Make it Yours</a>';
  assert.equal(_linksToPlace(html, 'cid-123'), true);
  assert.equal(_linksToPlace(html, 'cid-12'), false);
  assert.equal(_linksToPlace('<a href="/x?place_id=cid-123">', 'cid-123'), false);
});

test('checkout with domain: subscription mode, one-time site + yearly domain, rich metadata', () => {
  const p = buildSiteCheckoutParams(
    {
      placeId: 'cid-1',
      domain: 'acme.co.uk',
      domainAmountPence: 1500,
      netlifySiteId: 'site-uuid',
      netlifySiteName: 'tmbulk-acme',
      successUrl: 'https://x/y',
      cancelUrl: 'https://x/z',
    },
    { config: { siteAmountPence: 29900, renewalLeadDays: 30 } },
  );
  assert.equal(p.params.mode, 'subscription');
  assert.equal(p.params.line_items.length, 2);
  assert.equal(p.params.line_items[0].price_data.unit_amount, 29900);
  assert.equal(p.params.line_items[0].price_data.recurring, undefined);
  assert.equal(p.params.line_items[1].price_data.recurring.interval, 'year');
  assert.equal(p.params.subscription_data.trial_period_days, 365);
  assert.equal(p.params.metadata.domain_first_year_included, '1');
  assert.equal(p.params.metadata.domain_amount_pence, '1500');
  assert.equal(p.params.metadata.tld, 'co.uk');
  assert.equal(p.params.metadata.netlify_site_id, 'site-uuid');
  assert.equal(p.params.subscription_data.metadata.place_id, 'cid-1');
});

test('checkout without domain stays one-off payment mode', () => {
  const p = buildSiteCheckoutParams(
    { placeId: 'cid-1', successUrl: 'https://x/y', cancelUrl: 'https://x/z' },
    { config: { siteAmountPence: 29900 } },
  );
  assert.equal(p.params.mode, 'payment');
  assert.equal(p.params.line_items.length, 1);
});

test('fixed TLD retail prices and Porkbun cost guard', () => {
  const pricing = loadDomainPricingConfig();
  assert.equal(fixedYearlyPenceForDomain('x.co.uk', pricing).pence, 1500);
  assert.equal(fixedYearlyPenceForDomain('x.com', pricing).pence, 2000);
  assert.doesNotThrow(() =>
    assertPorkbunWithinClientPrice({ price: '5.66', renewalPrice: '5.66' }, 1500, 0.79),
  );
  assert.throws(
    () => assertPorkbunWithinClientPrice({ price: '25.00', renewalPrice: '25.00' }, 1500, 0.79),
    (e) => e.code === 'COST_ABOVE_CLIENT_PRICE',
  );
});

function renewalInvoiceEvent({ livemode = true, invoiceId = 'in_live_renew1', billing = 'subscription_cycle' } = {}) {
  return {
    id: 'evt_renew_1',
    type: 'invoice.paid',
    livemode,
    data: {
      object: {
        object: 'invoice',
        id: invoiceId,
        livemode,
        status: 'paid',
        paid: true,
        billing_reason: billing,
        subscription: 'sub_live_abc',
        subscription_details: {
          metadata: {
            product_type: 'site_checkout',
            place_id: 'cid-1',
            domain: 'acmebuilders.co.uk',
            domain_amount_pence: '1500',
            tld: 'co.uk',
          },
        },
      },
    },
  };
}

test('renewalFromInvoiceEvent ignores first invoice and non-domain invoices', () => {
  assert.equal(renewalFromInvoiceEvent(renewalInvoiceEvent({ billing: 'subscription_create' })), null);
  assert.equal(renewalFromInvoiceEvent(renewalInvoiceEvent({ billing: 'manual' })), null);
  const j = renewalFromInvoiceEvent(renewalInvoiceEvent());
  assert.equal(j.domain, 'acmebuilders.co.uk');
  assert.equal(j.domainAmountPence, 1500);
});

test('renewal on invoice.paid cycle: dry-run then live Porkbun renew', async () => {
  const calls = [];
  const porkbun = {
    checkDomain: async (d) => ({ domain: d, available: false, premium: false, price: '5.66', renewalPrice: '5.66' }),
    priceToCents: (p) => Math.round(Number(p) * 100),
    PORKBUN_API_ORDER_CAP_CENTS: 10000,
    buildRenewDomainRequest: (d, c, o) => ({ domain: d, cost: c, dryRun: o && o.dryRun }),
    renewDomain: async (o) => {
      calls.push(['renew', o]);
      return { renewed: true };
    },
  };
  const job = renewalFromInvoiceEvent(renewalInvoiceEvent());
  const dry = await fulfilDomainRenewal(job, { usdToGbp: 0.79, deps: { porkbun } });
  assert.equal(dry.status, 'dry_run');
  assert.equal(calls.length, 0);
  const live = await fulfilDomainRenewal(job, { purchaseLive: true, usdToGbp: 0.79, deps: { porkbun } });
  assert.equal(live.status, 'renewed');
  assert.equal(calls[0][1].idempotencyKey, 'tm-domain-renew-in_live_renew1');
});

test('renewal refuses premium and price above client guard', async () => {
  const porkbun = {
    checkDomain: async () => ({ available: false, premium: true, price: '5.66', renewalPrice: '5.66' }),
    priceToCents: (p) => Math.round(Number(p) * 100),
    PORKBUN_API_ORDER_CAP_CENTS: 10000,
    buildRenewDomainRequest: () => ({}),
  };
  const job = renewalFromInvoiceEvent(renewalInvoiceEvent());
  const r = await fulfilDomainRenewal(job, { purchaseLive: true, usdToGbp: 0.79, deps: { porkbun } });
  assert.equal(r.status, 'error');
  assert.equal(r.error.code, 'PREMIUM_REFUSED');
});

test('renewal skipped when subscription is lapsing', async () => {
  const job = renewalFromInvoiceEvent(renewalInvoiceEvent());
  const r = await fulfilDomainRenewal(job, { subscriptionLapsing: true, deps: { porkbun: {} } });
  assert.equal(r.status, 'skipped_lapsing');
});

test('customer.subscription.deleted parsed for lapsing', () => {
  const info = subscriptionDeletedFromEvent({
    type: 'customer.subscription.deleted',
    id: 'evt_sub_del',
    data: {
      object: {
        object: 'subscription',
        id: 'sub_live_abc',
        metadata: { product_type: 'site_checkout', domain: 'acme.co.uk', place_id: 'cid-1' },
      },
    },
  });
  assert.equal(info.subscriptionId, 'sub_live_abc');
  assert.equal(info.domain, 'acme.co.uk');
});

test('webhook handler: bad signature 400, good one queues once and starts the background job', async () => {
  const store = memoryStore();
  setOrdersStoreForTests(store);
  setBillingStoresForTests({ accounts: billingMemoryStore(), dunning: billingMemoryStore(), events: billingMemoryStore() });
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_test_only';
  process.env.URL = 'https://example.test';
  const { default: webhook } = await import('../netlify/functions/stripe-webhook.js');
  const triggered = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (triggered.push([url, JSON.parse(init.body)]), new Response('', { status: 202 }));
  try {
    const body = JSON.stringify(event({ livemode: true }));
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
    const bad = await webhook(new Request('https://example.test/api/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=00` } }));
    assert.equal(bad.status, 400);
    const ok = await webhook(new Request('https://example.test/api/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } }));
    assert.equal(ok.status, 200);
    assert.deepEqual(triggered, [['https://example.test/api/domain-fulfil', { sessionId: 'cs_live_abc' }]]);
    assert.equal((await store.get('cs_live_abc')).status, 'queued');
    // A replay after a real registration is a no-op.
    await store.setJSON('cs_live_abc', { ...(await store.get('cs_live_abc')), status: 'connected' });
    const dup = await webhook(new Request('https://example.test/api/stripe-webhook', { method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } }));
    assert.equal((await dup.json()).duplicate, 'connected');
    assert.equal(triggered.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('webhook: invoice.paid renewal queued once; subscription.deleted marks lapsing', async () => {
  const renewStore = memoryRenewalsStore();
  const subStore = memorySubscriptionStore();
  setRenewalsStoreForTests(renewStore);
  setSubscriptionStoreForTests(subStore);
  setBillingStoresForTests({ accounts: billingMemoryStore(), dunning: billingMemoryStore(), events: billingMemoryStore() });
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_test_only';
  process.env.URL = 'https://example.test';
  const { default: webhook } = await import('../netlify/functions/stripe-webhook.js');
  const triggered = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (triggered.push([url, JSON.parse(init.body)]), new Response('', { status: 202 }));
  try {
    const invBody = JSON.stringify(renewalInvoiceEvent());
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${invBody}`).digest('hex');
    const ok = await webhook(
      new Request('https://example.test/api/stripe-webhook', {
        method: 'POST',
        body: invBody,
        headers: { 'stripe-signature': `t=${t},v1=${sig}` },
      }),
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(triggered[0], ['https://example.test/api/domain-renew', { invoiceId: 'in_live_renew1' }]);
    await renewStore.setJSON('in_live_renew1', { ...(await renewStore.get('in_live_renew1')), status: 'renewed' });
    const dup = await webhook(
      new Request('https://example.test/api/stripe-webhook', {
        method: 'POST',
        body: invBody,
        headers: { 'stripe-signature': `t=${t},v1=${sig}` },
      }),
    );
    assert.equal((await dup.json()).duplicate, 'renewed');
    assert.equal(triggered.length, 1);

    const subBody = JSON.stringify({
      id: 'evt_sub_del',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          object: 'subscription',
          id: 'sub_live_abc',
          metadata: { product_type: 'site_checkout', domain: 'acmebuilders.co.uk', place_id: 'cid-1' },
        },
      },
    });
    const t2 = t + 1;
    const sig2 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t2}.${subBody}`).digest('hex');
    const laps = await webhook(
      new Request('https://example.test/api/stripe-webhook', {
        method: 'POST',
        body: subBody,
        headers: { 'stripe-signature': `t=${t2},v1=${sig2}` },
      }),
    );
    assert.equal((await laps.json()).lapsing, 'sub_live_abc');
    assert.equal((await subStore.get('sub_live_abc')).status, 'lapsing');
  } finally {
    globalThis.fetch = realFetch;
  }
});
