/**
 * Stripe reads and writes for the daily billing job.
 * Callers pass fetchImpl and the secret key. Unit tests never use the live key.
 */
import { formatGbpPence } from '../../../shared/billing-plans.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const SITE_QUERY = "metadata['product_type']:'site_checkout'";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function accountFromSubscription(sub) {
  if (!sub || sub.object !== 'subscription') return null;
  const metadata = sub.metadata || {};
  if (metadata.product_type !== 'site_checkout') return null;
  if (sub.status === 'incomplete' || sub.status === 'incomplete_expired') return null;
  const invoice = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
  const customer = sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
  const plan = metadata.plan === 'monthly' ? 'monthly' : 'one_off';
  const domainAmountPence = Number.isInteger(Number(metadata.domain_amount_pence))
    ? Number(metadata.domain_amount_pence)
    : null;
  return {
    id: sub.id,
    subscriptionId: sub.id,
    plan,
    stripeStatus: sub.status || null,
    placeId: metadata.place_id || null,
    domain: metadata.domain || null,
    email: (customer && customer.email) || null,
    phone: metadata.phone || null,
    netlifySiteId: metadata.netlify_site_id || null,
    netlifySiteName: metadata.netlify_site_name || null,
    domainAmountPence,
    priceLabel: domainAmountPence != null ? `${formatGbpPence(domainAmountPence)}/year` : null,
    customerId: customer ? customer.id : typeof sub.customer === 'string' ? sub.customer : null,
    hostedInvoiceUrl: invoice ? invoice.hosted_invoice_url || null : null,
    latestInvoiceId: invoice ? invoice.id : typeof sub.latest_invoice === 'string' ? sub.latest_invoice : null,
    latestInvoiceStatus: invoice ? invoice.status || null : null,
    renewalAt: renewalIso(sub, plan),
    domainRenewsAt: plan === 'monthly' ? addOneYearIso(sub.start_date || sub.created) : renewalIso(sub, plan),
  };
}

function addOneYearIso(unixSeconds) {
  if (!unixSeconds) return null;
  const date = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

function renewalIso(sub, plan) {
  if (plan === 'one_off' && sub.current_period_end) {
    return new Date(Number(sub.current_period_end) * 1000).toISOString();
  }
  if (plan === 'monthly') return addOneYearIso(sub.start_date || sub.created);
  return null;
}

export function openInvoiceFromAccount(account) {
  if (!account || !account.latestInvoiceId) return null;
  if (account.latestInvoiceStatus === 'paid' || account.latestInvoiceStatus === 'void') return null;
  const retryable = account.stripeStatus === 'past_due' || account.latestInvoiceStatus === 'open';
  if (!retryable) return null;
  return {
    invoiceId: account.latestInvoiceId,
    plan: account.plan,
    hostedInvoiceUrl: account.hostedInvoiceUrl || null,
    email: account.email || null,
    phone: account.phone || null,
    domain: account.domain || null,
    subscriptionId: account.subscriptionId,
    siteId: account.netlifySiteId || null,
    siteName: account.netlifySiteName || null,
    placeId: account.placeId || null,
    domainRenewalDue: account.plan === 'one_off' ? true : account.domainRenewalDue === true,
    wasPaused: account.localPaused === true,
  };
}

export async function listSiteCheckoutPage({ page, limit = 100, fetchImpl = fetch, key, sleepImpl = sleep } = {}) {
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY is not set. No subscription list.');
    err.code = 'NO_STRIPE';
    throw err;
  }
  const params = new URLSearchParams();
  params.set('query', SITE_QUERY);
  params.set('limit', String(Math.min(100, Math.max(1, limit))));
  if (page) params.set('page', page);
  params.append('expand[]', 'data.latest_invoice');
  params.append('expand[]', 'data.customer');
  const url = `${STRIPE_API}/subscriptions/search?${params.toString()}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'taylor-marriott-billing' },
      });
      const data = await readJson(res);
      if (!res.ok) {
        const err = new Error((data.error && data.error.message) || `Stripe search ${res.status}`);
        err.status = res.status;
        err.code = 'STRIPE';
        throw err;
      }
      return {
        subscriptions: Array.isArray(data.data) ? data.data : [],
        hasMore: data.has_more === true,
        nextPage: data.next_page || null,
      };
    } catch (err) {
      lastErr = err;
      const status = err.status;
      if (status && status < 500 && status !== 429) throw err;
      if (attempt === 2) throw err;
      await sleepImpl(200 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function payInvoice(invoiceId, { fetchImpl = fetch, key, todayKey } = {}) {
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY is not set. Invoice not charged.');
    err.code = 'NO_STRIPE';
    throw err;
  }
  const res = await fetchImpl(`${STRIPE_API}/invoices/${encodeURIComponent(invoiceId)}/pay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `tm-pay-${invoiceId}-${todayKey || 'day'}`,
      'User-Agent': 'taylor-marriott-billing',
    },
  });
  const data = await readJson(res);
  if (res.ok) {
    return {
      paid: data.paid === true || data.status === 'paid',
      hostedInvoiceUrl: data.hosted_invoice_url || null,
      status: data.status || null,
    };
  }
  const type = data.error && data.error.type;
  const code = data.error && data.error.code;
  if (res.status === 402 || type === 'card_error') {
    return {
      paid: false,
      hostedInvoiceUrl: data.hosted_invoice_url || null,
      status: 'open',
      error: code || 'card_error',
    };
  }
  const err = new Error((data.error && data.error.message) || `Stripe pay ${res.status}`);
  err.status = res.status;
  err.code = 'STRIPE';
  throw err;
}

export async function markInvoiceUncollectible(invoiceId, { fetchImpl = fetch, key } = {}) {
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY is not set. Invoice not marked uncollectible.');
    err.code = 'NO_STRIPE';
    throw err;
  }
  const res = await fetchImpl(`${STRIPE_API}/invoices/${encodeURIComponent(invoiceId)}/mark_uncollectible`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `tm-uncollectible-${invoiceId}`,
      'User-Agent': 'taylor-marriott-billing',
    },
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe mark_uncollectible ${res.status}`);
    err.status = res.status;
    err.code = 'STRIPE';
    throw err;
  }
  return { status: data.status || 'uncollectible', id: data.id || invoiceId };
}

export async function createPortalUrl({ customerId, returnUrl, fetchImpl = fetch, key } = {}) {
  if (!key || !customerId) return null;
  const body = new URLSearchParams();
  body.set('customer', customerId);
  body.set('return_url', returnUrl || 'https://taylor-marriott.com');
  const res = await fetchImpl(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'taylor-marriott-billing',
    },
    body: body.toString(),
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe portal ${res.status}`);
    err.status = res.status;
    err.code = 'STRIPE';
    throw err;
  }
  return data.url || null;
}
