import { getStore } from '@netlify/blobs';

const STORE_NAME = 'domain-renewals';
let override = null;

export function setRenewalsStoreForTests(store) {
  override = store;
}

export function renewalsStore() {
  return override || getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function getRenewal(invoiceId, store = renewalsStore()) {
  return (await store.get(String(invoiceId), { type: 'json' })) || null;
}

export async function putRenewal(invoiceId, record, store = renewalsStore()) {
  await store.setJSON(String(invoiceId), { ...record, invoiceId: String(invoiceId), updatedAt: new Date().toISOString() });
}

/** Completed renewal — do not run Porkbun renew again for this invoice. */
export const RENEWAL_DONE_STATUSES = Object.freeze(['renewed', 'dry_run', 'processing']);

export function memoryRenewalsStore() {
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
