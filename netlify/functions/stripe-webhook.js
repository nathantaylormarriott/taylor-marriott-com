import { verifyStripeWebhook } from './_shared/domain-checkout.js';
import { orderFromEvent } from './_shared/domain-fulfil.js';
import { renewalFromInvoiceEvent, subscriptionDeletedFromEvent } from './_shared/domain-renew.js';
import { getOrder, putOrder, FINAL_STATUSES } from './_shared/domainOrders.js';
import { getRenewal, putRenewal, RENEWAL_DONE_STATUSES } from './_shared/domainRenewals.js';
import { putSubscriptionRecord, markSubscriptionLapsing, getSubscriptionRecord } from './_shared/domainSubscriptions.js';
import { sendCheckoutPaymentEmails, sendInvoicePaymentFailedEmail, sendSubscriptionLapsingEmail, subscriptionLapsingFromUpdatedEvent } from './_shared/checkout-mail.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function handleCheckoutCompleted(event, base) {
  try {
    await sendCheckoutPaymentEmails(event);
  } catch (err) {
    console.error('[stripe-webhook] payment emails', err.message);
  }

  let order;
  try {
    order = orderFromEvent(event);
  } catch (err) {
    console.error('[stripe-webhook] bad order', event.id, err.message);
    return json({ received: true, ignored: 'bad_domain' });
  }
  if (!order) {
    console.info('[stripe-webhook]', event.type, event.id, 'no domain to register');
    return json({ received: true, ignored: true });
  }

  try {
    const existing = await getOrder(order.sessionId);
    if (existing && FINAL_STATUSES.includes(existing.status)) {
      console.info('[stripe-webhook] duplicate', order.sessionId, existing.status);
      return json({ received: true, duplicate: existing.status });
    }
    await putOrder(order.sessionId, {
      ...(existing || {}),
      order,
      status: 'queued',
      registered: existing ? existing.registered === true : false,
      events: [...((existing && existing.events) || []), event.id].slice(-20),
    });
    if (order.subscriptionId) {
      const subExisting = (await getSubscriptionRecord(order.subscriptionId)) || {};
      await putSubscriptionRecord(order.subscriptionId, {
        ...subExisting,
        sessionId: order.sessionId,
        domain: order.domain,
        placeId: order.placeId,
        status: subExisting.status === 'lapsing' ? 'lapsing' : 'active',
        events: [...(subExisting.events || []), event.id].slice(-20),
      });
    }
  } catch (err) {
    console.error('[stripe-webhook] store', err);
    return json({ error: 'could not queue order' }, 500);
  }

  try {
    const res = await fetch(`${base}/api/domain-fulfil`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: order.sessionId }),
    });
    console.info('[stripe-webhook] queued', order.sessionId, order.domain, 'background', res.status);
  } catch (err) {
    console.error('[stripe-webhook] could not start background job', err.message);
    return json({ error: 'could not start fulfilment' }, 500);
  }
  return json({ received: true, queued: order.sessionId });
}

async function handleRenewalInvoice(event, base) {
  let job;
  try {
    job = renewalFromInvoiceEvent(event);
  } catch (err) {
    console.error('[stripe-webhook] bad renewal', event.id, err.message);
    return json({ received: true, ignored: 'bad_renewal' });
  }
  if (!job) {
    return json({ received: true, ignored: true });
  }

  try {
    const existing = await getRenewal(job.invoiceId);
    if (existing && RENEWAL_DONE_STATUSES.includes(existing.status)) {
      console.info('[stripe-webhook] renewal duplicate', job.invoiceId, existing.status);
      return json({ received: true, duplicate: existing.status });
    }
    await putRenewal(job.invoiceId, {
      ...(existing || {}),
      job,
      status: 'queued',
      events: [...((existing && existing.events) || []), event.id].slice(-20),
    });
  } catch (err) {
    console.error('[stripe-webhook] renewal store', err);
    return json({ error: 'could not queue renewal' }, 500);
  }

  try {
    const res = await fetch(`${base}/api/domain-renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: job.invoiceId }),
    });
    console.info('[stripe-webhook] renewal queued', job.invoiceId, job.domain, res.status);
  } catch (err) {
    console.error('[stripe-webhook] could not start renewal job', err.message);
    return json({ error: 'could not start renewal' }, 500);
  }
  return json({ received: true, renewalQueued: job.invoiceId });
}

async function handleSubscriptionDeleted(event) {
  const info = subscriptionDeletedFromEvent(event);
  if (!info) return json({ received: true, ignored: true });

  try {
    await markSubscriptionLapsing(info.subscriptionId, info.eventId);
    if (info.subscriptionId) {
      const sub = await getSubscriptionRecord(info.subscriptionId);
      if (sub && sub.sessionId) {
        const ord = await getOrder(sub.sessionId);
        if (ord) {
          await putOrder(sub.sessionId, {
            ...ord,
            subscriptionStatus: 'lapsing',
            events: [...(ord.events || []), info.eventId].slice(-20),
          });
        }
      }
    }
    console.warn('[stripe-webhook] subscription lapsing', info.subscriptionId, info.domain);
  } catch (err) {
    console.error('[stripe-webhook] lapsing mark failed', err);
    return json({ error: 'could not mark lapsing' }, 500);
  }
  try {
    await sendSubscriptionLapsingEmail({ ...info, status: info.status || 'canceled' });
  } catch (err) {
    console.error('[stripe-webhook] lapsing email', err.message);
  }
  return json({ received: true, lapsing: info.subscriptionId });
}

async function handleSubscriptionUpdated(event) {
  const info = subscriptionLapsingFromUpdatedEvent(event);
  if (!info) return json({ received: true, ignored: true });

  try {
    await markSubscriptionLapsing(info.subscriptionId, info.eventId);
  } catch (err) {
    console.error('[stripe-webhook] lapsing mark (updated)', err);
    return json({ error: 'could not mark lapsing' }, 500);
  }
  try {
    await sendSubscriptionLapsingEmail(info);
  } catch (err) {
    console.error('[stripe-webhook] lapsing email (updated)', err.message);
  }
  return json({ received: true, lapsing: info.subscriptionId });
}

async function handleInvoicePaymentFailed(event) {
  try {
    await sendInvoicePaymentFailedEmail(event);
  } catch (err) {
    console.error('[stripe-webhook] invoice.payment_failed email', err.message);
  }
  return json({ received: true });
}

/**
 * Stripe webhooks: checkout (checkout.session.completed), renewals (invoice.paid),
 * failed payments (invoice.payment_failed), subscription lapsing (deleted / updated unpaid).
 */
export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = request.headers.get('stripe-signature') || '';
  const rawBody = await request.text();

  let event;
  try {
    event = verifyStripeWebhook(rawBody, signature);
  } catch (err) {
    console.error('[stripe-webhook]', err.code || '', err.message);
    return json({ error: err.message }, err.code === 'BAD_STRIPE_SIGNATURE' ? 400 : 503);
  }

  const base = process.env.URL || new URL(request.url).origin;

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event, base);
    case 'invoice.paid':
      return handleRenewalInvoice(event, base);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event);
    default:
      return json({ received: true, ignored: event.type });
  }
};

export const config = {
  path: '/api/stripe-webhook',
};
