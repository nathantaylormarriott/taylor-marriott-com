import { verifyStripeWebhook } from './_shared/domain-checkout.js';
import { orderFromEvent } from './_shared/domain-fulfil.js';
import { getOrder, putOrder, FINAL_STATUSES } from './_shared/domainOrders.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Stripe -> verify signature -> queue the domain order -> hand it to the
 * domain-fulfil background function (register at Porkbun, DNS, Netlify attach).
 * Answers Stripe fast; the slow work runs in the background function.
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
  } catch (err) {
    console.error('[stripe-webhook] store', err);
    return json({ error: 'could not queue order' }, 500); // Stripe retries
  }

  const base = process.env.URL || new URL(request.url).origin;
  try {
    const res = await fetch(`${base}/api/domain-fulfil`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: order.sessionId }),
    });
    console.info('[stripe-webhook] queued', order.sessionId, order.domain, 'background', res.status);
  } catch (err) {
    console.error('[stripe-webhook] could not start background job', err.message);
    return json({ error: 'could not start fulfilment' }, 500); // Stripe retries
  }
  return json({ received: true, queued: order.sessionId });
};

export const config = {
  path: '/api/stripe-webhook',
};
