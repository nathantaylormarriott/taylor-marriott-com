import { getStore } from '@netlify/blobs';

const STORE_NAME = 'domain-orders';
let override = null;

/** Tests and local dry runs only: swap in an in-memory store. */
export function setOrdersStoreForTests(store) {
  override = store;
}

export function ordersStore() {
  return override || getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function getOrder(sessionId, store = ordersStore()) {
  return (await store.get(sessionId, { type: 'json' })) || null;
}

export async function putOrder(sessionId, record, store = ordersStore()) {
  await store.setJSON(sessionId, { ...record, updatedAt: new Date().toISOString() });
}

/** Statuses that must never be queued again (a real registration happened, or a run is in flight). */
export const FINAL_STATUSES = Object.freeze(['registered', 'connected', 'processing']);

export function memoryStore() {
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
