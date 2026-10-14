/**
 * Live USD→GBP for the customer domain price and the Porkbun cost guard.
 * Fallback: fresh cache → live APIs → last-known-good blob → CHECKOUT_USD_TO_GBP / config.
 */
import { resolveUsdToGbp } from './checkout-config.js';
import { readFxRecord, writeFxRecord } from './fx-rates-store.js';

export const FX_CACHE_MS = 60 * 60 * 1000;
export const FX_FETCH_TIMEOUT_MS = 2000;
export const FX_MIN_RATE = 0.5;
export const FX_MAX_RATE = 1.2;

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=GBP';
const OPEN_ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

let memoryEntry = null;
let fetchImpl = globalThis.fetch;

export function setUsdGbpFetchForTests(fn) {
  fetchImpl = fn || globalThis.fetch;
}

export function _clearUsdGbpMemoryCacheForTests() {
  memoryEntry = null;
}

export function isSaneFxRate(rate) {
  return Number.isFinite(rate) && rate >= FX_MIN_RATE && rate <= FX_MAX_RATE;
}

async function fetchJson(url, { timeoutMs = FX_FETCH_TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'taylor-marriott-checkout-fx' },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = new Error(`FX HTTP ${res.status} ${url}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFrankfurterUsdGbp() {
  const data = await fetchJson(FRANKFURTER_URL);
  const rate = data && data.rates && data.rates.GBP;
  if (!isSaneFxRate(Number(rate))) {
    const err = new Error('Frankfurter returned out-of-bounds GBP rate');
    err.code = 'FX_BOUNDS';
    throw err;
  }
  return { rate: Number(rate), source: 'live:frankfurter.app' };
}

export async function fetchOpenErApiUsdGbp() {
  const data = await fetchJson(OPEN_ER_API_URL);
  const rate = data && data.rates && data.rates.GBP;
  if (!isSaneFxRate(Number(rate))) {
    const err = new Error('open.er-api.com returned out-of-bounds GBP rate');
    err.code = 'FX_BOUNDS';
    throw err;
  }
  return { rate: Number(rate), source: 'live:open.er-api.com' };
}

function resolveEnvFallback(env = process.env) {
  return resolveUsdToGbp({ env });
}

function logFx(entry) {
  console.info('[fx/usd-gbp]', {
    rate: entry.rate,
    source: entry.source,
    at: new Date(entry.fetchedAt).toISOString(),
  });
}

/**
 * @returns {Promise<{ rate: number|null, source: string|null, fetchedAt: number }>}
 */
export async function getUsdToGbp({ env = process.env, now = Date.now() } = {}) {
  if (memoryEntry && now - memoryEntry.fetchedAt < FX_CACHE_MS && isSaneFxRate(memoryEntry.rate)) {
    return memoryEntry;
  }

  let blobRecord = null;
  try {
    blobRecord = await readFxRecord();
  } catch (err) {
    console.warn('[fx/usd-gbp] blob read failed', err.message);
  }

  if (
    blobRecord &&
    isSaneFxRate(blobRecord.rate) &&
    now - Number(blobRecord.fetchedAt) < FX_CACHE_MS
  ) {
    memoryEntry = {
      rate: blobRecord.rate,
      source: `cache:blob:${blobRecord.source || 'unknown'}`,
      fetchedAt: Number(blobRecord.fetchedAt),
    };
    logFx(memoryEntry);
    return memoryEntry;
  }

  const liveSources = [
    () => fetchFrankfurterUsdGbp(),
    () => fetchOpenErApiUsdGbp(),
  ];
  for (const load of liveSources) {
    try {
      const live = await load();
      const entry = { rate: live.rate, source: live.source, fetchedAt: now };
      memoryEntry = entry;
      try {
        await writeFxRecord({ rate: entry.rate, source: entry.source, fetchedAt: entry.fetchedAt });
      } catch (err) {
        console.warn('[fx/usd-gbp] blob write failed', err.message);
      }
      logFx(entry);
      return entry;
    } catch (err) {
      console.warn('[fx/usd-gbp] live source failed', err.message);
    }
  }

  if (blobRecord && isSaneFxRate(blobRecord.rate)) {
    const entry = {
      rate: blobRecord.rate,
      source: `fallback:blob-last-known:${blobRecord.source || 'unknown'}`,
      fetchedAt: Number(blobRecord.fetchedAt) || now,
    };
    memoryEntry = entry;
    console.warn('[fx/usd-gbp] using last-known-good blob', entry);
    return entry;
  }

  const fb = resolveEnvFallback(env);
  if (isSaneFxRate(fb.rate)) {
    const entry = { rate: fb.rate, source: fb.source || 'fallback:env', fetchedAt: now };
    memoryEntry = entry;
    console.warn('[fx/usd-gbp] using env/config fallback', entry);
    return entry;
  }

  return { rate: null, source: null, fetchedAt: now };
}

/** Merge live FX into checkout config used for Porkbun guards. */
export async function attachLiveFxToCheckoutConfig(config, opts = {}) {
  const fx = await getUsdToGbp(opts);
  if (!isSaneFxRate(fx.rate)) {
    return { ...config, usdToGbp: null, usdToGbpSource: null, usdToGbpFetchedAt: fx.fetchedAt };
  }
  return {
    ...config,
    usdToGbp: fx.rate,
    usdToGbpSource: fx.source,
    usdToGbpFetchedAt: fx.fetchedAt,
    domainPricing: {
      ...(config.domainPricing || {}),
      usdToGbp: fx.rate,
    },
  };
}
