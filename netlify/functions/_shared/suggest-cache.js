const store = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function cacheGet(key, { now = Date.now() } = {}) {
  const hit = store.get(key);
  if (!hit) return null;
  if (now - hit.at > hit.ttlMs) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key, value, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  store.set(key, { at: now, ttlMs, value });
}

export function cacheKey(parts) {
  return Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v || '').trim().toLowerCase()}`)
    .join('|');
}

export function _clearSuggestCacheForTests() {
  store.clear();
}
