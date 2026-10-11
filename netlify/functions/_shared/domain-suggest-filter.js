import { quoteFromCheckAndTld, porkbunRowToSearchResult } from './domainSearchMap.js';
import { assertPorkbunWithinClientPrice } from './domain-pricing.js';
import { tldOf } from './checkout-config.js';

const TLD_RANK = { 'co.uk': 30, 'uk': 20, com: 10 };

/**
 * Drop taken, premium, unresolved, and domains that fail the retail price guard.
 */
export function filterSuggestionChecks(checkRows, tldPricing, config) {
  const out = [];
  for (const row of checkRows) {
    const mapped = porkbunRowToSearchResult(row, tldPricing, config);
    if (mapped.state !== 'available' || mapped.clientPricePence == null) continue;
    const quote = quoteFromCheckAndTld(row, tldPricing);
    try {
      assertPorkbunWithinClientPrice(quote, mapped.clientPricePence, config.usdToGbp);
    } catch {
      continue;
    }
    out.push({
      ...mapped,
      reason: row.reason || null,
      score: scoreDomain(mapped.domain),
    });
  }
  out.sort((a, b) => b.score - a.score);
  const seenLabel = new Set();
  const picked = [];
  for (const row of out) {
    const label = row.domain.replace(/\.(co\.uk|com|uk)$/, '');
    if (seenLabel.has(label)) continue;
    seenLabel.add(label);
    picked.push(row);
    if (picked.length >= 6) break;
  }
  return picked.slice(0, 6);
}

function scoreDomain(domain) {
  const tld = tldOf(domain);
  return (TLD_RANK[tld] || 0) * 100 - domain.length;
}

/** Unit tests: filter without Porkbun using pre-mapped rows. */
export function filterMappedSuggestions(rows, { usdToGbp = 0.79 } = {}) {
  const out = [];
  for (const mapped of rows) {
    if (mapped.state !== 'available' || mapped.clientPricePence == null) continue;
    if (mapped._quote) {
      try {
        assertPorkbunWithinClientPrice(mapped._quote, mapped.clientPricePence, usdToGbp);
      } catch {
        continue;
      }
    }
    out.push({ ...mapped, score: scoreDomain(mapped.domain) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 6);
}
