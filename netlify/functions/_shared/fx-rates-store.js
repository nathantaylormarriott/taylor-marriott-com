import { getStore } from '@netlify/blobs';

const STORE_NAME = 'checkout-fx-rates';
const FX_KEY = 'usd-gbp';
let override = null;

export function setFxRatesStoreForTests(store) {
  override = store;
}

export function fxRatesStore() {
  return override || getStore({ name: STORE_NAME, consistency: 'strong' });
}

export async function readFxRecord(store = fxRatesStore()) {
  return (await store.get(FX_KEY, { type: 'json' })) || null;
}

export async function writeFxRecord(record, store = fxRatesStore()) {
  await store.setJSON(FX_KEY, { ...record, updatedAt: new Date().toISOString() });
}

export function memoryFxStore() {
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
