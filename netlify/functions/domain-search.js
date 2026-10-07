import { handleOptions, jsonResponse } from './_shared/http.js';
import { loadCheckoutConfig } from './_shared/checkout-config.js';
import { checkDomains, getTldPricing, toDomainLabel } from './_shared/porkbun-client.js';
import { porkbunRowToSearchResult } from './_shared/domainSearchMap.js';
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

  const config = loadCheckoutConfig();
  if (config.usdToGbp == null) {
    return jsonResponse(request, { error: 'Domain pricing is not configured (usdToGbp)' }, 503);
  }

  const url = new URL(request.url);
  const placeId = String(url.searchParams.get('place_id') || '').trim();
  const qRaw = String(url.searchParams.get('q') || '').trim();

  if (!placeId || !PLACE_ID_RE.test(placeId)) {
    return jsonResponse(request, { error: 'Invalid or missing place_id' }, 400);
  }

  let query;
  try {
    query = toDomainLabel(qRaw);
  } catch (err) {
    return jsonResponse(request, { error: err.message || 'Invalid search label' }, 400);
  }

  try {
    const [check, tldPricing] = await Promise.all([
      checkDomains(query, config.offeredTlds),
      getTldPricing(config.offeredTlds),
    ]);

    const results = check.results.map((row) => porkbunRowToSearchResult(row, tldPricing, config));

    return jsonResponse(
      request,
      {
        query: check.baseName,
        pricingConfigured: true,
        fx: { usdToGbp: config.usdToGbp, source: config.usdToGbpSource },
        results,
      },
      200,
      { 'Cache-Control': 'private, no-store' },
    );
  } catch (err) {
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
