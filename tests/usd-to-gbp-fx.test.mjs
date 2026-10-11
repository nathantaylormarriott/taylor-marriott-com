import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUsdToGbp,
  fetchFrankfurterUsdGbp,
  setUsdGbpFetchForTests,
  _clearUsdGbpMemoryCacheForTests,
  FX_CACHE_MS,
  isSaneFxRate,
} from '../netlify/functions/_shared/usd-to-gbp-fx.js';
import { setFxRatesStoreForTests, memoryFxStore } from '../netlify/functions/_shared/fx-rates-store.js';

const NOW = 1_700_000_000_000;

function mockFetch(handlers) {
  return async (url) => {
    for (const [prefix, fn] of handlers) {
      if (String(url).startsWith(prefix)) return fn(url);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

test('isSaneFxRate bounds', () => {
  assert.equal(isSaneFxRate(0.79), true);
  assert.equal(isSaneFxRate(0.49), false);
  assert.equal(isSaneFxRate(1.21), false);
});

test('fetchFrankfurterUsdGbp parses rate', async () => {
  setUsdGbpFetchForTests(async () => ({
    ok: true,
    async text() {
      return JSON.stringify({ rates: { GBP: 0.8012 } });
    },
  }));
  const r = await fetchFrankfurterUsdGbp();
  assert.equal(r.rate, 0.8012);
  assert.match(r.source, /frankfurter/);
});

test('getUsdToGbp uses fresh memory cache', async () => {
  _clearUsdGbpMemoryCacheForTests();
  setFxRatesStoreForTests(memoryFxStore());
  let calls = 0;
  setUsdGbpFetchForTests(async () => {
    calls += 1;
    return {
      ok: true,
      async text() {
        return JSON.stringify({ rates: { GBP: 0.77 } });
      },
    };
  });
  const a = await getUsdToGbp({ now: NOW });
  const b = await getUsdToGbp({ now: NOW + 1000 });
  assert.equal(a.rate, 0.77);
  assert.equal(b.rate, 0.77);
  assert.equal(calls, 1);
});

test('getUsdToGbp falls back to secondary API when primary fails', async () => {
  _clearUsdGbpMemoryCacheForTests();
  setFxRatesStoreForTests(memoryFxStore());
  setUsdGbpFetchForTests(
    mockFetch([
      ['https://api.frankfurter.app', async () => {
        throw new Error('primary down');
      }],
      ['https://open.er-api.com', async () => ({
        ok: true,
        async text() {
          return JSON.stringify({ result: 'success', rates: { GBP: 0.78 } });
        },
      })],
    ]),
  );
  const r = await getUsdToGbp({ now: NOW + FX_CACHE_MS + 1 });
  assert.equal(r.rate, 0.78);
  assert.match(r.source, /open\.er-api/);
});

test('getUsdToGbp uses stale blob when live sources fail', async () => {
  _clearUsdGbpMemoryCacheForTests();
  const store = memoryFxStore();
  setFxRatesStoreForTests(store);
  await store.setJSON('usd-gbp', {
    rate: 0.76,
    source: 'live:frankfurter.app',
    fetchedAt: NOW - FX_CACHE_MS - 1000,
  });
  setUsdGbpFetchForTests(async () => {
    throw new Error('all live down');
  });
  const r = await getUsdToGbp({ now: NOW, env: {} });
  assert.equal(r.rate, 0.76);
  assert.match(r.source, /blob-last-known/);
});

test('getUsdToGbp uses CHECKOUT_USD_TO_GBP when cache and live fail', async () => {
  _clearUsdGbpMemoryCacheForTests();
  setFxRatesStoreForTests(memoryFxStore());
  setUsdGbpFetchForTests(async () => {
    throw new Error('all live down');
  });
  const r = await getUsdToGbp({ now: NOW, env: { CHECKOUT_USD_TO_GBP: '0.79' } });
  assert.equal(r.rate, 0.79);
  assert.match(r.source, /CHECKOUT_USD_TO_GBP/);
});

test('getUsdToGbp ignores out-of-bounds live rate and falls back', async () => {
  _clearUsdGbpMemoryCacheForTests();
  setFxRatesStoreForTests(memoryFxStore());
  setUsdGbpFetchForTests(
    mockFetch([
      ['https://api.frankfurter.app', async () => ({
        ok: true,
        async text() {
          return JSON.stringify({ rates: { GBP: 2.5 } });
        },
      })],
      ['https://open.er-api.com', async () => ({
        ok: true,
        async text() {
          return JSON.stringify({ rates: { GBP: 2.5 } });
        },
      })],
    ]),
  );
  const r = await getUsdToGbp({ now: NOW, env: { CHECKOUT_USD_TO_GBP: '0.81' } });
  assert.equal(r.rate, 0.81);
});
