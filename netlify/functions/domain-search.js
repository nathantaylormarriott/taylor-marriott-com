import { handleOptions, jsonResponse } from './_shared/http.js';
import { loadCheckoutConfigWithFx } from './_shared/checkout-config-async.js';
import { getTldPricing } from './_shared/porkbun-client.js';
import { runDomainSearch } from './_shared/domain-search-run.js';
import { clientIp, rateLimit } from './_shared/rateLimit.js';

const PLACE_ID_RE = /^[^\s?#&=]{6,256}$/;

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const ip = clientIp(request);
  const rl = rateLimit(`domain-search:${ip}`, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return jsonResponse(
      request,
      { error: 'Too many searches. Try again shortly.' },
      429,
      { 'Retry-After': String(rl.retryAfterSec) },
    );
  }

  const config = await loadCheckoutConfigWithFx();
  if (config.usdToGbp == null) {
    return jsonResponse(request, { error: 'fx_unavailable' }, 503);
  }

  const url = new URL(request.url);
  const placeId = String(url.searchParams.get('place_id') || '').trim();
  const qRaw = String(url.searchParams.get('q') || '');

  if (!placeId || !PLACE_ID_RE.test(placeId)) {
    return jsonResponse(request, { error: 'Invalid or missing place_id' }, 400);
  }

  try {
    const out = await runDomainSearch(qRaw, config, { getTldPricing });
    return jsonResponse(
      request,
      {
        query: out.query,
        mode: out.parsed.mode,
        primaryDomain: out.primaryDomain,
        pricingConfigured: true,
        results: out.results,
        alternatives: out.alternatives,
      },
      200,
      { 'Cache-Control': 'private, no-store' },
    );
  } catch (err) {
    if (err.code === 'BAD_SEARCH' || err.code === 'empty' || err.code === 'chars' || err.code === 'hyphen' || err.code === 'tld' || err.code === 'short' || err.code === 'format' || err.code === 'length') {
      return jsonResponse(request, { error: err.message, code: err.code }, 400);
    }
    console.error('[domain-search]', err);
    if (err.code === 'NO_PORKBUN') {
      return jsonResponse(request, { error: 'Domain search is not configured' }, 503);
    }
    return jsonResponse(request, { error: 'Could not search domains' }, 502);
  }
};

export const config = {
  path: '/api/domain-search',
};
