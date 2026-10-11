#!/usr/bin/env node
/**
 * End-to-end dry run of the post-payment domain flow, locally:
 *   signed fake Stripe event -> /api/stripe-webhook handler -> /api/domain-fulfil background handler
 *   -> REAL Porkbun availability/price check + REAL Netlify site lookup (both read-only)
 *   -> register / DNS / Netlify attach built as requests, NOT sent.
 *
 * Usage: PORKBUN_API_KEY=… PORKBUN_SECRET_API_KEY=… NETLIFY_AUTH_TOKEN=… \
 *        node scripts/domain-fulfil-dryrun.mjs <place_id> <domain> [domain_amount_pence]
 * Kill switches are forced off and the Stripe event is test-mode, so nothing can be bought.
 */
import crypto from 'node:crypto';
import { setOrdersStoreForTests, memoryStore } from '../netlify/functions/_shared/domainOrders.js';

const [placeId, domain, amount = ''] = process.argv.slice(2);
if (!placeId || !domain) {
  console.error('usage: node scripts/domain-fulfil-dryrun.mjs <place_id> <domain> [domain_amount_pence]');
  process.exit(2);
}
process.env.DOMAIN_PURCHASE_LIVE = '0';
process.env.DOMAIN_CONNECT_LIVE = '0';
process.env.STRIPE_WEBHOOK_SECRET = `whsec_local_dryrun_${crypto.randomBytes(8).toString('hex')}`;
process.env.URL = 'https://dryrun.local';

const store = memoryStore();
setOrdersStoreForTests(store);
const { default: webhook } = await import('../netlify/functions/stripe-webhook.js');
const { default: background } = await import('../netlify/functions/domain-fulfil.js');

const realFetch = globalThis.fetch;
let pending = null;
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://dryrun.local/api/domain-fulfil') {
    pending = background(new Request(url, init));
    return new Response('', { status: 202 });
  }
  if (/\/domain\/create\/|\/dns\/(create|delete)|updateAutoRenew|\/ssl$/.test(String(url)) || (init && init.method === 'PATCH')) {
    throw new Error(`DRY RUN GUARD: refused to send ${init && init.method} ${url}`);
  }
  return realFetch(url, init);
};

const sessionId = `cs_test_dryrun${Date.now()}`;
const event = {
  id: `evt_dryrun_${Date.now()}`,
  type: 'checkout.session.completed',
  livemode: false,
  data: {
    object: {
      object: 'checkout.session', id: sessionId, livemode: false, payment_status: 'paid',
      client_reference_id: placeId,
      metadata: { product_type: 'site_checkout', place_id: placeId, domain, ...(amount ? { domain_amount_pence: amount } : {}) },
    },
  },
};
const body = JSON.stringify(event);
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
const res = await webhook(new Request('https://dryrun.local/api/stripe-webhook', {
  method: 'POST', body, headers: { 'stripe-signature': `t=${t},v1=${sig}` },
}));
console.log('webhook ->', res.status, await res.text());
if (pending) await pending;
const rec = await store.get(sessionId);
console.log(JSON.stringify({ status: rec && rec.status, result: rec && rec.lastResult }, null, 2));
