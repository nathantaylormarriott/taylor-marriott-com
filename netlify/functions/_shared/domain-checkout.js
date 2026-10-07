import crypto from 'node:crypto';
import { normalizeDomain } from './porkbun-client.js';
import { loadCheckoutConfig, DEFAULT_RENEWAL_LEAD_DAYS } from './checkout-config.js';

const STRIPE_API = 'https://api.stripe.com/v1';
export const SITE_PRODUCT_TYPE = 'site_checkout';
const MIN_AMOUNT_PENCE = 30;
const DEFAULT_WEBHOOK_TOLERANCE_SEC = 300;

function requireStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY is not set. No Stripe Checkout Session created.');
    err.code = 'NO_STRIPE';
    err.missing = ['STRIPE_SECRET_KEY'];
    throw err;
  }
  return key;
}

export function stripeKeyMode() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  return 'unknown';
}

function isHttpUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
}

function validationError(msg) {
  const err = new Error(msg);
  err.code = 'BAD_CHECKOUT_INPUT';
  return err;
}

export function buildSiteCheckoutParams(input = {}, { allowIncomplete = false, config } = {}) {
  const {
    placeId,
    customerEmail,
    domain,
    domainAmountPence,
    siteAmountPence,
    successUrl,
    cancelUrl,
    siteProductName,
  } = input || {};

  if (!placeId || typeof placeId !== 'string') throw validationError('placeId required');

  const cfg = config || loadCheckoutConfig();
  const site =
    siteAmountPence == null || siteAmountPence === '' ? cfg.siteAmountPence : Number(siteAmountPence);
  if (!Number.isInteger(site) || site < MIN_AMOUNT_PENCE) {
    throw validationError(`siteAmountPence must be an integer >= ${MIN_AMOUNT_PENCE}`);
  }

  const hasDomain = domain != null && String(domain).trim() !== '';
  const apex = hasDomain ? normalizeDomain(domain) : '';
  let domainAmount = null;
  if (hasDomain) {
    const n = domainAmountPence == null || domainAmountPence === '' ? NaN : Number(domainAmountPence);
    if (!Number.isInteger(n) || n <= 0) {
      throw validationError(
        `domainAmountPence (positive integer pence per year) is required with a domain (domain ${apex})`,
      );
    }
    if (n < MIN_AMOUNT_PENCE) throw validationError(`domainAmountPence must be >= ${MIN_AMOUNT_PENCE}`);
    domainAmount = n;
  }

  const missing = [];
  for (const [name, val] of [
    ['successUrl', successUrl],
    ['cancelUrl', cancelUrl],
  ]) {
    if (!val) {
      if (!allowIncomplete) throw validationError(`${name} required`);
      missing.push(name);
    } else if (!isHttpUrl(val)) {
      throw validationError(`${name} must be an http(s) URL`);
    }
  }
  if (
    customerEmail != null &&
    customerEmail !== '' &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)
  ) {
    throw validationError('customerEmail is not an email address');
  }

  const metadata = { product_type: SITE_PRODUCT_TYPE, place_id: placeId, domain: apex };
  const leadDays = Number.isInteger(cfg.renewalLeadDays) ? cfg.renewalLeadDays : DEFAULT_RENEWAL_LEAD_DAYS;
  if (hasDomain) metadata.renewal_lead_days = String(leadDays);

  const lineItems = [
    {
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: site,
        product_data: { name: siteProductName || 'Website (one-time)', metadata: { ...metadata } },
      },
    },
  ];
  if (hasDomain) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: domainAmount,
        recurring: { interval: 'year', interval_count: 1 },
        product_data: { name: `Domain: ${apex} (yearly)`, metadata: { ...metadata } },
      },
    });
  }

  const params = {
    mode: hasDomain ? 'subscription' : 'payment',
    success_url: successUrl || null,
    cancel_url: cancelUrl || null,
    client_reference_id: placeId,
    line_items: lineItems,
    metadata: { ...metadata },
  };
  if (hasDomain) {
    params.subscription_data = {
      metadata: { ...metadata },
      description: `Domain registration and renewal for ${apex}`,
    };
  } else {
    params.payment_intent_data = { metadata: { ...metadata } };
  }
  if (customerEmail) params.customer_email = customerEmail;

  return {
    params,
    missing,
    placeId,
    domain: apex,
    siteAmountPence: site,
    domainAmountPence: domainAmount,
    currency: 'gbp',
  };
}

function toStripeForm(obj, prefix = '', out = new URLSearchParams()) {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => toStripeForm(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      toStripeForm(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return out;
  }
  out.append(prefix, String(obj));
  return out;
}

async function postCheckoutSession(params, { idempotencyKey } = {}) {
  const key = requireStripeKey();
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'taylor-marriott-checkout',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers,
    body: toStripeForm(params).toString(),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Stripe API ${res.status} /checkout/sessions`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = 'STRIPE';
    err.stripeCode = (data && data.error && data.error.code) || null;
    throw err;
  }
  return {
    id: data && data.id,
    url: data && data.url,
    mode: data && data.mode,
    livemode: data ? Boolean(data.livemode) : null,
    metadata: (data && data.metadata) || null,
    keyMode: stripeKeyMode(),
  };
}

export async function createSiteCheckoutSession(input = {}, { idempotencyKey, config } = {}) {
  const plan = buildSiteCheckoutParams(input, { allowIncomplete: false, config });
  const session = await postCheckoutSession(plan.params, { idempotencyKey });
  return { live: true, keyMode: session.keyMode, plan, session };
}

export function verifyStripeWebhook(rawBody, signatureHeader, opts = {}) {
  const secret = opts.secret || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const err = new Error('STRIPE_WEBHOOK_SECRET is not set. Webhook not verified.');
    err.code = 'NO_STRIPE_WEBHOOK_SECRET';
    throw err;
  }
  const tolerance = opts.toleranceSec ?? DEFAULT_WEBHOOK_TOLERANCE_SEC;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const parts = String(signatureHeader || '')
    .split(',')
    .map((p) => p.trim());
  let t = null;
  const v1 = [];
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    if (k === 't') t = Number(v);
    else if (k === 'v1') v1.push(v);
  }
  const fail = (msg) => {
    const err = new Error(msg);
    err.code = 'BAD_STRIPE_SIGNATURE';
    return err;
  };
  if (!Number.isFinite(t) || !v1.length) throw fail('Stripe-Signature header missing t or v1');
  if (tolerance > 0 && Math.abs(now - t) > tolerance) throw fail('Stripe webhook timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
  const expBuf = Buffer.from(expected, 'hex');
  const ok = v1.some((sig) => {
    const b = Buffer.from(sig, 'hex');
    return b.length === expBuf.length && crypto.timingSafeEqual(b, expBuf);
  });
  if (!ok) throw fail('Stripe webhook signature mismatch');
  return JSON.parse(body);
}

export function siteCheckoutIdempotencyKey(placeId, domain) {
  const d = domain ? normalizeDomain(domain) : '';
  const raw = `site_checkout:${placeId}:${d}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
