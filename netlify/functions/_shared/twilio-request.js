/**
 * Twilio inbound webhook checks.
 * Signature is HMAC-SHA1 of the public URL plus sorted form fields, base64.
 * Fail closed when the auth token is missing.
 */
import crypto from 'node:crypto';

function headerFirst(request, name) {
  const raw = request.headers.get(name);
  if (!raw) return '';
  return String(raw).split(',')[0].trim();
}

/** Public URL Twilio signed. Prefer forwarded proto and host from Netlify. */
export function publicWebhookUrl(request) {
  const url = new URL(request.url);
  const forwardedProto = headerFirst(request, 'x-forwarded-proto').replace(/:$/, '');
  const forwardedHost = headerFirst(request, 'x-forwarded-host') || headerFirst(request, 'host');
  const proto = forwardedProto || url.protocol.replace(/:$/, '');
  const host = forwardedHost || url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

export function formParams(rawBody) {
  const params = new URLSearchParams(String(rawBody || ''));
  const out = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

export function expectedTwilioSignature(authToken, url, params) {
  const keys = Object.keys(params || {}).sort();
  let data = String(url || '');
  for (const key of keys) data += key + String(params[key] ?? '');
  return crypto.createHmac('sha1', String(authToken)).update(data, 'utf8').digest('base64');
}

export function twilioSignaturesMatch(expected, received) {
  const left = Buffer.from(String(expected || ''));
  const right = Buffer.from(String(received || ''));
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
