import { verifyStripeWebhook } from './_shared/domain-checkout.js';

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = request.headers.get('stripe-signature') || '';
  const rawBody = await request.text();

  try {
    const event = verifyStripeWebhook(rawBody, signature);
    const type = event?.type || 'unknown';
    const meta =
      event?.data?.object?.metadata ||
      event?.data?.object?.subscription_details?.metadata ||
      null;
    console.info('[stripe-webhook]', type, meta ? JSON.stringify(meta) : '');
    // TODO: full domain register + Netlify connect lives on the bulk-websites pipeline (DOMAIN_PURCHASE_LIVE).
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[stripe-webhook]', err);
    const status = err.code === 'BAD_STRIPE_SIGNATURE' ? 400 : 503;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/stripe-webhook',
};
