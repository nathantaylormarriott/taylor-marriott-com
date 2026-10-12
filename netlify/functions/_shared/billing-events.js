/**
 * Pure Stripe event parsers for billing. No network, no pause.
 * A single invoice.payment_failed does not pause. Only a final subscription
 * status (unpaid or canceled) does.
 */
import { SITE_PRODUCT_TYPE } from './domain-checkout.js';
import { isTerminalUnpaidStatus } from '../../../shared/billing-lifecycle.js';

function subscriptionMetadata(invoiceOrSub) {
  const fromSub =
    (invoiceOrSub.subscription_details && invoiceOrSub.subscription_details.metadata) ||
    (invoiceOrSub.parent &&
      invoiceOrSub.parent.subscription_details &&
      invoiceOrSub.parent.subscription_details.metadata) ||
    null;
  if (fromSub && Object.keys(fromSub).length) return fromSub;
  return invoiceOrSub.metadata || {};
}

function isSiteCheckout(metadata) {
  return metadata && metadata.product_type === SITE_PRODUCT_TYPE;
}

export function paymentFailedFromEvent(event) {
  if (!event || event.type !== 'invoice.payment_failed') return null;
  const inv = event.data && event.data.object;
  if (!inv || inv.object !== 'invoice') return null;
  const metadata = subscriptionMetadata(inv);
  if (!isSiteCheckout(metadata)) return null;
  const subscription = inv.subscription;
  return {
    eventId: event.id,
    invoiceId: inv.id,
    subscriptionId: typeof subscription === 'string' ? subscription : (subscription && subscription.id) || null,
    hostedInvoiceUrl: inv.hosted_invoice_url || null,
    plan: metadata.plan === 'monthly' ? 'monthly' : 'one_off',
    domain: metadata.domain || null,
    placeId: metadata.place_id || null,
    phone: metadata.phone || null,
    email: inv.customer_email || null,
    netlifySiteId: metadata.netlify_site_id || null,
    netlifySiteName: metadata.netlify_site_name || null,
    pause: false,
  };
}

export function subscriptionStatusFromEvent(event) {
  if (!event) return null;
  if (event.type !== 'customer.subscription.updated' && event.type !== 'customer.subscription.deleted') return null;
  const sub = event.data && event.data.object;
  if (!sub || sub.object !== 'subscription') return null;
  const metadata = sub.metadata || {};
  if (!isSiteCheckout(metadata)) return null;
  const status = sub.status || (event.type === 'customer.subscription.deleted' ? 'canceled' : null);
  return {
    eventId: event.id,
    subscriptionId: sub.id,
    status,
    terminal: isTerminalUnpaidStatus(status),
    plan: metadata.plan === 'monthly' ? 'monthly' : 'one_off',
    domain: metadata.domain || null,
    placeId: metadata.place_id || null,
    phone: metadata.phone || null,
    email: (sub.customer && sub.customer.email) || null,
    customerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || null,
    netlifySiteId: metadata.netlify_site_id || null,
    netlifySiteName: metadata.netlify_site_name || null,
    pause: isTerminalUnpaidStatus(status),
  };
}

export function checkoutAccountFromEvent(event) {
  if (!event || event.type !== 'checkout.session.completed') return null;
  const session = event.data && event.data.object;
  if (!session || session.object !== 'checkout.session') return null;
  const metadata = session.metadata || {};
  if (!isSiteCheckout(metadata)) return null;
  if (session.payment_status !== 'paid') return null;
  const id = session.subscription || session.id;
  if (!id) return null;
  return {
    id,
    subscriptionId: session.subscription || null,
    sessionId: session.id,
    plan: metadata.plan === 'monthly' ? 'monthly' : 'one_off',
    stripeStatus: 'active',
    domain: metadata.domain || null,
    placeId: metadata.place_id || session.client_reference_id || null,
    phone: metadata.phone || null,
    email: (session.customer_details && session.customer_details.email) || session.customer_email || null,
    customerId: session.customer || null,
    netlifySiteId: metadata.netlify_site_id || null,
    netlifySiteName: metadata.netlify_site_name || null,
    domainAmountPence: Number.isInteger(Number(metadata.domain_amount_pence))
      ? Number(metadata.domain_amount_pence)
      : null,
    localPaused: false,
  };
}
