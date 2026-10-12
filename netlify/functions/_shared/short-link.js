/**
 * Short pay links: https://taylor-marriott.com/p/<8 chars>
 * The blob stores the Stripe hosted invoice or customer portal URL.
 */
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { SHORT_LINK_ID_LENGTH, SHORT_LINK_ORIGIN } from '../../../shared/sms-templates.js';

const STORE = 'billing-short-links';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALLOWED_HOSTS = new Set([
  'invoice.stripe.com',
  'billing.stripe.com',
  'pay.stripe.com',
  'checkout.stripe.com',
]);

let override = null;

export function setShortLinkStoreForTests(store) {
  override = store;
}

function store() {
  return override || getStore({ name: STORE, consistency: 'strong' });
}

export function assertPayableUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    const err = new Error('Pay link is not a URL.');
    err.code = 'BAD_PAY_LINK';
    throw err;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    const err = new Error('Pay link must be https with no login or port.');
    err.code = 'BAD_PAY_LINK';
    throw err;
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    const err = new Error('Pay link host is not a Stripe invoice or portal URL.');
    err.code = 'BAD_PAY_LINK';
    throw err;
  }
  return parsed.toString();
}

function newId() {
  const bytes = crypto.randomBytes(SHORT_LINK_ID_LENGTH);
  let id = '';
  for (let i = 0; i < SHORT_LINK_ID_LENGTH; i += 1) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

export function shortLinkUrl(id) {
  return `${SHORT_LINK_ORIGIN}${id}`;
}

export async function createShortLink(url, storeImpl = store()) {
  const target = assertPayableUrl(url);
  for (let i = 0; i < 5; i += 1) {
    const id = newId();
    const existing = await storeImpl.get(id, { type: 'json' });
    if (existing) continue;
    await storeImpl.setJSON(id, { url: target, at: new Date().toISOString() });
    return shortLinkUrl(id);
  }
  const err = new Error('Could not allocate a short pay link.');
  err.code = 'SHORT_LINK';
  throw err;
}

export async function readShortLink(id, storeImpl = store()) {
  if (!/^[A-Za-z0-9]{8}$/.test(String(id || ''))) return null;
  const row = await storeImpl.get(id, { type: 'json' });
  if (!row || !row.url) return null;
  try {
    return assertPayableUrl(row.url);
  } catch {
    return null;
  }
}
