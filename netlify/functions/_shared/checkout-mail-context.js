import { CLIENT_SITES } from './client-sites.js';
import { SITE_PRODUCT_TYPE, stripeKeyMode } from './domain-checkout.js';
import { formatGbpPence, renewalMonthYear } from '../../../shared/domain-package.js';
import * as porkbun from './porkbun-client.js';

export function stripeDashboardBase(livemode) {
  const keyMode = stripeKeyMode();
  const test = livemode === false || keyMode === 'test';
  return test ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';
}

export function checkoutSessionFromEvent(event) {
  if (!event || event.type !== 'checkout.session.completed') return null;
  const s = event.data && event.data.object;
  if (!s || s.object !== 'checkout.session') return null;
  const m = s.metadata || {};
  if (m.product_type !== SITE_PRODUCT_TYPE) return null;
  if (s.payment_status !== 'paid') return null;

  const placeId = m.place_id || s.client_reference_id || null;
  const registry = placeId ? CLIENT_SITES[placeId] : null;
  const domainRaw = String(m.domain || '').trim();
  const domain = domainRaw ? porkbun.normalizeDomain(domainRaw) : null;
  const domainAmountPence = Number.isInteger(Number(m.domain_amount_pence)) ? Number(m.domain_amount_pence) : null;

  return {
    eventId: event.id,
    livemode: event.livemode === true && s.livemode === true,
    sessionId: s.id,
    mode: s.mode || null,
    placeId,
    business: (registry && registry.business) || null,
    domain,
    domainAmountPence,
    tld: m.tld || null,
    customerEmail:
      (s.customer_details && s.customer_details.email) || s.customer_email || null,
    customerId: s.customer || null,
    subscriptionId: s.subscription || null,
    amountTotal: s.amount_total ?? null,
    currency: s.currency || 'gbp',
  };
}

export function formatAmount(session) {
  if (!Number.isInteger(session.amountTotal)) return '—';
  const cur = String(session.currency || 'gbp').toUpperCase();
  if (cur === 'GBP') return formatGbpPence(session.amountTotal) || '—';
  return `${(session.amountTotal / 100).toFixed(2)} ${cur}`;
}

export function renewalCopyForSession(session, fromDate = new Date()) {
  if (!session.domain || !session.domainAmountPence) return null;
  const when = renewalMonthYear(fromDate);
  const yearly = formatGbpPence(session.domainAmountPence);
  return { when, yearly, line: `Domain ${session.domain}: year one included in your payment. Renewal ${yearly}/year from ${when} unless you cancel.` };
}

export function stripeSessionUrl(session) {
  const base = stripeDashboardBase(session.livemode);
  return `${base}/checkout/sessions/${session.sessionId}`;
}

export function stripeCustomerUrl(session) {
  if (!session.customerId) return null;
  const base = stripeDashboardBase(session.livemode);
  return `${base}/customers/${session.customerId}`;
}
