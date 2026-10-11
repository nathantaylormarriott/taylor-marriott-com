import { handleOptions, jsonResponse } from './_shared/http.js';
import { loadCheckoutConfig } from './_shared/checkout-config.js';
import { checkDomainList } from './_shared/porkbun-client.js';
import { getTldPricing } from './_shared/porkbun-client.js';
import { resolveCheckoutBusinessContext } from './_shared/checkout-business-context.js';
import { generateSuggestionDomainCandidates } from './_shared/domain-suggest-candidates.js';
import { filterSuggestionChecks } from './_shared/domain-suggest-filter.js';
import { cacheGet, cacheSet, cacheKey } from './_shared/suggest-cache.js';
import { clientIp, rateLimit } from './_shared/rateLimit.js';

const PLACE_ID_RE = /^[^\s?#&=]{6,256}$/;

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const ip = clientIp(request);
  const rl = rateLimit(`domain-suggestions:${ip}`, { limit: 12, windowMs: 60_000 });
  if (!rl.allowed) {
    return jsonResponse(
      request,
      { error: 'Too many suggestion requests. Try again shortly.' },
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
  if (!placeId || !PLACE_ID_RE.test(placeId)) {
    return jsonResponse(request, { error: 'Invalid or missing place_id' }, 400);
  }

  const ctx = resolveCheckoutBusinessContext(placeId, {
    business: url.searchParams.get('business'),
    trade: url.searchParams.get('trade'),
    town: url.searchParams.get('town'),
  });

  const key = cacheKey({
    placeId,
    business: ctx.businessName,
    trade: ctx.trade,
    town: ctx.town,
  });
  const cached = cacheGet(key);
  if (cached) {
    return jsonResponse(request, cached, 200, {
      'Cache-Control': 'private, max-age=120',
      'X-Suggestions-Cache': 'hit',
    });
  }

  const candidates = generateSuggestionDomainCandidates(ctx);
  if (!candidates.length) {
    const empty = {
      context: { businessName: ctx.businessName, trade: ctx.trade, town: ctx.town, source: ctx.source },
      suggestions: [],
      candidateCount: 0,
    };
    cacheSet(key, empty);
    return jsonResponse(request, empty, 200, { 'Cache-Control': 'private, max-age=60' });
  }

  try {
    const reasonByDomain = new Map(candidates.map((c) => [c.domain, c.reason]));
    const [check, tldPricing] = await Promise.all([
      checkDomainList(candidates.map((c) => c.domain)),
      getTldPricing(['co.uk', 'com', 'uk']),
    ]);
    const rows = check.results.map((r) => ({ ...r, reason: reasonByDomain.get(r.domain) || null }));
    const suggestions = filterSuggestionChecks(rows, tldPricing, config);
    const body = {
      context: { businessName: ctx.businessName, trade: ctx.trade, town: ctx.town, source: ctx.source },
      suggestions,
      candidateCount: candidates.length,
    };
    cacheSet(key, body);
    return jsonResponse(request, body, 200, {
      'Cache-Control': 'private, max-age=120',
      'X-Suggestions-Cache': 'miss',
    });
  } catch (err) {
    console.error('[domain-suggestions]', err);
    if (err.code === 'NO_PORKBUN') {
      return jsonResponse(request, { error: 'Domain suggestions are not configured' }, 503);
    }
    return jsonResponse(request, { error: 'Could not load suggestions' }, 502);
  }
};

export const config = {
  path: '/api/domain-suggestions',
};
