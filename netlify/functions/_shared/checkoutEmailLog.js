import { getStore } from '@netlify/blobs';

const STORE_NAME = 'checkout-emails';
let override = null;

export function setCheckoutEmailStoreForTests(store) {
  override = store;
}

export function checkoutEmailStore() {
  return override || getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function wasEmailSent(key, store = checkoutEmailStore()) {
  const k = String(key || '').trim();
  if (!k) return false;
  const hit = await store.get(k, { type: 'json' });
  return Boolean(hit && hit.sentAt);
}

export async function markEmailSent(key, meta = {}, store = checkoutEmailStore()) {
  const k = String(key || '').trim();
  if (!k) throw new Error('email log key required');
  await store.setJSON(k, { sentAt: new Date().toISOString(), ...meta });
}

/**
 * Send at most once per key. Never throws — logs failures.
 * @param {string} key
 * @param {() => Promise<{ skipped?: boolean, ok?: boolean }>} sendFn
 */
export async function sendEmailOnce(key, sendFn, store = checkoutEmailStore()) {
  try {
    if (await wasEmailSent(key, store)) {
      return { duplicate: true };
    }
    const result = await sendFn();
    if (result && result.skipped) {
      return { skipped: true, reason: result.reason };
    }
    if (result && result.ok === false) {
      return { failed: true, result };
    }
    await markEmailSent(key, { result: result || {} }, store);
    return { sent: true, result };
  } catch (err) {
    console.error('[checkout-email]', key, err.message);
    return { error: err.message };
  }
}

export function memoryCheckoutEmailStore() {
  const m = new Map();
  return {
    map: m,
    async get(k) {
      return m.has(k) ? JSON.parse(m.get(k)) : null;
    },
    async setJSON(k, v) {
      m.set(k, JSON.stringify(v));
    },
  };
}
