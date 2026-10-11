// node --test tests/  (no network: Porkbun, Netlify and the background trigger are mocked)
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fulfilDomainOrder, orderFromEvent } from '../netlify/functions/_shared/domain-fulfil.js';
import { buildSiteCheckoutParams } from '../netlify/functions/_shared/domain-checkout.js';
import { conflictingDnsRecords, netlifyDnsRecords } from '../netlify/functions/_shared/porkbun-client.js';
import { _linksToPlace } from '../netlify/functions/_shared/netlify-sites.js';
import { setOrdersStoreForTests, memoryStore } from '../netlify/functions/_shared/domainOrders.js';

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
  deps.netlify.resolveClientSite = async () => ({ ...SITE, customDomain: 'other.com' });
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

test('checkout session metadata carries domain_amount_pence', () => {
  const p = buildSiteCheckoutParams(
    { placeId: 'cid-1', domain: 'acme.co.uk', domainAmountPence: 448, successUrl: 'https://x/y', cancelUrl: 'https://x/z' },
    { config: { siteAmountPence: 29900, renewalLeadDays: 30 } },
  );
  assert.equal(p.params.metadata.domain_amount_pence, '448');
});

test('webhook handler: bad signature 400, good one queues once and starts the background job', async () => {
  const store = memoryStore();
  setOrdersStoreForTests(store);
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
