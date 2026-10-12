import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyClientSiteForPlace,
  resolveClientSite,
  resolveSiteForOrder,
  linksToPlace,
  siteOnTeam,
} from '../netlify/functions/_shared/netlify-sites.js';
import {
  memoryClientSiteResolveCacheStore,
  setClientSiteResolveCacheStoreForTests,
} from '../netlify/functions/_shared/clientSiteResolveCache.js';
import { normalizeVerifiedPreviewSite } from '../shared/checkout-preview-site.js';

const PLACE = 'cid-test-place-123';
const SITE_ID = '11111111-1111-1111-1111-111111111111';

const HTML_OK = `<a href="https://taylor-marriott.com/checkout?place_id=${PLACE}&business=x">Buy</a>`;
const HTML_BAD = `<a href="https://taylor-marriott.com/checkout?place_id=other">Buy</a>`;

function mockSite(overrides = {}) {
  return {
    id: SITE_ID,
    name: 'atherstone-plumbing-co-ltd',
    account_slug: 'nathantaylormarriott',
    ssl_url: 'https://atherstone-plumbing-co-ltd.netlify.app',
    url: 'https://atherstone-plumbing-co-ltd.netlify.app',
    custom_domain: null,
    domain_aliases: [],
    ...overrides,
  };
}

test('verifyClientSiteForPlace accepts matching homepage link', async () => {
  const deps = {
    netlifyApi: async () => mockSite(),
    fetch: async () => ({ ok: true, text: async () => HTML_OK }),
  };
  const site = await verifyClientSiteForPlace(SITE_ID, PLACE, deps);
  assert.equal(site.siteName, 'atherstone-plumbing-co-ltd');
  assert.equal(site.source, 'verified');
});

test('verifyClientSiteForPlace rejects place_id mismatch', async () => {
  const deps = {
    netlifyApi: async () => mockSite(),
    fetch: async () => ({ ok: true, text: async () => HTML_BAD }),
  };
  await assert.rejects(() => verifyClientSiteForPlace(SITE_ID, PLACE, deps), (err) => err.code === 'PLACE_MISMATCH');
});

test('verifyClientSiteForPlace rejects other team', async () => {
  const deps = {
    netlifyApi: async () => mockSite({ account_slug: 'someone-else' }),
    fetch: async () => ({ ok: true, text: async () => HTML_OK }),
  };
  await assert.rejects(() => verifyClientSiteForPlace(SITE_ID, PLACE, deps), (err) => err.code === 'WRONG_TEAM');
});

test('resolveSiteForOrder uses metadata site id before scan', async () => {
  const calls = [];
  const deps = {
    netlifyApi: async (path) => {
      calls.push(path);
      return mockSite();
    },
    fetch: async () => ({ ok: true, text: async () => HTML_OK }),
  };
  const site = await resolveSiteForOrder(
    { placeId: PLACE, netlifySiteId: SITE_ID },
    deps,
  );
  assert.equal(site.siteId, SITE_ID);
  assert.ok(calls.some((p) => p.includes(SITE_ID)));
  assert.equal(calls.filter((p) => p.includes('/sites?')).length, 0);
});

test('resolveClientSite scans all team sites without tmbulk prefix', async () => {
  const cache = memoryClientSiteResolveCacheStore();
  setClientSiteResolveCacheStoreForTests(cache);
  const teamSite = mockSite({ name: 'plain-repo-name-no-prefix' });
  const deps = {
    netlifyApi: async (path) => {
      if (path.includes('/sites?')) return [teamSite];
      throw new Error(`unexpected ${path}`);
    },
    fetch: async () => ({ ok: true, text: async () => HTML_OK }),
    cache: { blobStore: cache },
  };
  const site = await resolveClientSite(PLACE, { registry: {}, useCache: false, deps });
  assert.equal(site.siteName, 'plain-repo-name-no-prefix');
  setClientSiteResolveCacheStoreForTests(null);
});

test('normalizeVerifiedPreviewSite allows custom domain URLs', () => {
  assert.equal(
    normalizeVerifiedPreviewSite('https://www.example-plumber.co.uk/page'),
    'https://www.example-plumber.co.uk/page',
  );
  assert.equal(normalizeVerifiedPreviewSite('http://bad.com/'), '');
});

test('linksToPlace matches encoded place_id', () => {
  assert.ok(linksToPlace(HTML_OK, PLACE));
  assert.ok(siteOnTeam(mockSite()));
});
