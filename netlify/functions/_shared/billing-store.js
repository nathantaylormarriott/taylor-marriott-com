import { getStore } from '@netlify/blobs';

const ACCOUNTS = 'billing-accounts';
const DUNNING = 'billing-dunning';
const EVENTS = 'billing-events';

let accountsOverride = null;
let dunningOverride = null;
let eventsOverride = null;

export function setBillingStoresForTests({ accounts, dunning, events } = {}) {
  if (accounts) accountsOverride = accounts;
  if (dunning) dunningOverride = dunning;
  if (events) eventsOverride = events;
}

export function memoryStore() {
  const m = new Map();
  return {
    map: m,
    async get(k, opts) {
      if (!m.has(k)) return null;
      const raw = m.get(k);
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async setJSON(k, v) {
      m.set(k, JSON.stringify(v));
    },
    async list() {
      return { blobs: [...m.keys()].map((key) => ({ key })) };
    },
  };
}

function store(name, override) {
  return override || getStore({ name, consistency: 'strong' });
}

export function accountsStore() {
  return store(ACCOUNTS, accountsOverride);
}
export function dunningStore() {
  return store(DUNNING, dunningOverride);
}
export function eventsStore() {
  return store(EVENTS, eventsOverride);
}

export async function getAccount(id, storeImpl = accountsStore()) {
  return (await storeImpl.get(id, { type: 'json' })) || null;
}

export async function putAccount(id, record, storeImpl = accountsStore()) {
  const next = { ...record, id, updatedAt: new Date().toISOString() };
  await storeImpl.setJSON(id, next);
  return next;
}

export async function getDunning(invoiceId, storeImpl = dunningStore()) {
  return (await storeImpl.get(invoiceId, { type: 'json' })) || null;
}

export async function putDunning(invoiceId, record, storeImpl = dunningStore()) {
  const next = { ...record, invoiceId, updatedAt: new Date().toISOString() };
  await storeImpl.setJSON(invoiceId, next);
  return next;
}

export async function appendBillingEvent(event, storeImpl = eventsStore()) {
  const id = event.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const row = { ...event, id, at: event.at || new Date().toISOString() };
  await storeImpl.setJSON(id, row);
  return row;
}
