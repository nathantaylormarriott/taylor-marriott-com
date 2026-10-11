import { getStore } from '@netlify/blobs';

const STORE_NAME = 'client-site-resolve';
export const RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;

let override = null;

export function setClientSiteResolveCacheStoreForTests(store) {
  override = store;
}

function store() {
  return override || getStore({ name: STORE_NAME, consistency: 'strong' });
}

function cacheKey(placeId) {
  return `place:${String(placeId || '').trim()}`;
}

export async function getCachedClientSite(placeId, { ttlMs = RESOLVE_CACHE_TTL_MS, blobStore = store() } = {}) {
  const k = cacheKey(placeId);
  if (!k || k === 'place:') return null;
  const rec = (await blobStore.get(k, { type: 'json' })) || null;
  if (!rec || !rec.resolvedAt || !rec.site) return null;
  const age = Date.now() - new Date(rec.resolvedAt).getTime();
  if (!Number.isFinite(age) || age > ttlMs) return null;
  return rec.site;
}

export async function setCachedClientSite(placeId, site, { blobStore = store() } = {}) {
  const k = cacheKey(placeId);
  if (!k || k === 'place:') return;
  await blobStore.setJSON(k, { resolvedAt: new Date().toISOString(), site });
}

export function memoryClientSiteResolveCacheStore() {
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
