import { getStore } from '@netlify/blobs';

const STORE_NAME = 'domain-subscriptions';
let override = null;

export function setSubscriptionStoreForTests(store) {
  override = store;
}

export function subscriptionStore() {
  return override || getStore({ name: STORE_NAME, consistency: 'strong' });
}

function keyForSubscription(subscriptionId) {
  return String(subscriptionId || '').trim();
}

export async function getSubscriptionRecord(subscriptionId, store = subscriptionStore()) {
  const k = keyForSubscription(subscriptionId);
  if (!k) return null;
  return (await store.get(k, { type: 'json' })) || null;
}

export async function putSubscriptionRecord(subscriptionId, record, store = subscriptionStore()) {
  const k = keyForSubscription(subscriptionId);
  if (!k) throw new Error('subscriptionId required');
  await store.setJSON(k, { ...record, subscriptionId: k, updatedAt: new Date().toISOString() });
}

export async function markSubscriptionLapsing(subscriptionId, eventId, store = subscriptionStore()) {
  const existing = (await getSubscriptionRecord(subscriptionId, store)) || {};
  await putSubscriptionRecord(
    subscriptionId,
    {
      ...existing,
      status: 'lapsing',
      lapsingAt: new Date().toISOString(),
      events: [...(existing.events || []), eventId].slice(-20),
    },
    store,
  );
}

export function memorySubscriptionStore() {
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
