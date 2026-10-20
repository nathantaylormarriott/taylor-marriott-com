/**
 * POST /api/twilio-inbound
 * Inbound SMS and WhatsApp from Twilio. Never replies to the sender.
 * Twilio still applies its own SMS STOP handling.
 */
import { readEnv } from './_shared/billing-env.js';
import {
  findBillingAccountByPhone,
  markInboundNotified,
  outreachStore,
  parseTwilioInbound,
  recordInboundMessage,
} from './_shared/inbound-store.js';
import { notifyInboundReply } from './_shared/inbound-notify.js';
import {
  expectedTwilioSignature,
  formParams,
  publicWebhookUrl,
  twilioSignaturesMatch,
} from './_shared/twilio-request.js';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

function twiml() {
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function text(body, status) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleTwilioInbound(request, deps = {}) {
  if (request.method !== 'POST') return text('Method not allowed', 405);

  const env = deps.env || process.env;
  const rawBody = await request.text();
  const params = formParams(rawBody);
  const token = String(readEnv('TWILIO_AUTH_TOKEN', env) || '').trim();
  if (!token) {
    console.error(
      '[twilio-inbound] TWILIO_AUTH_TOKEN is missing. Rejecting inbound webhook (fail closed).',
    );
    return text('Forbidden', 403);
  }

  const url = publicWebhookUrl(request);
  const received = request.headers.get('x-twilio-signature') || '';
  const expected = expectedTwilioSignature(token, url, params);
  if (!twilioSignaturesMatch(expected, received)) {
    console.error('[twilio-inbound] invalid X-Twilio-Signature');
    return text('Forbidden', 403);
  }

  const receivedAt = typeof deps.now === 'function' ? deps.now() : new Date().toISOString();
  const parsed = parseTwilioInbound(params, receivedAt);
  const store = deps.store || outreachStore();

  let recorded;
  try {
    recorded = await recordInboundMessage(parsed, store);
  } catch (err) {
    console.error('[twilio-inbound]', err.code || '', err.message);
    const status = err.code === 'BAD_FROM' || err.code === 'BAD_SID' ? 400 : 500;
    return text(err.message || 'Bad request', status);
  }

  if (recorded.duplicate && recorded.message && recorded.message.notified) {
    return twiml();
  }

  let account = null;
  try {
    const lookup = deps.findBillingAccountByPhone || findBillingAccountByPhone;
    account = await lookup(parsed.from);
  } catch (err) {
    console.error('[twilio-inbound] lead lookup failed', err.message);
  }

  try {
    await notifyInboundReply({
      message: recorded.message,
      lead: recorded.lead,
      account,
      env,
      send: deps.sendMail,
    });
    await markInboundNotified(recorded.message.messageSid, store);
  } catch (err) {
    console.error('[twilio-inbound] notify failed', err.message);
    return text('Notify failed', 500);
  }

  return twiml();
}

export default async (request) => handleTwilioInbound(request);

export const config = {
  path: '/api/twilio-inbound',
};
