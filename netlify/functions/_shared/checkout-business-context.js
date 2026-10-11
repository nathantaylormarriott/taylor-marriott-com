import { CLIENT_SITES } from './client-sites.js';

const LTD_RE = /\b(l\.?\s?l\.?\s?p\.?|ltd\.?|limited|plc)\b/gi;

/**
 * Resolve business / trade / town for domain suggestions (query params override registry).
 */
export function resolveCheckoutBusinessContext(placeId, query = {}) {
  const hit = CLIENT_SITES[placeId] || null;
  let business = pick(query.business) || (hit && hit.business) || '';
  let trade = pick(query.trade) || (hit && hit.trade) || '';
  let town = pick(query.town) || (hit && hit.town) || '';

  if ((!town || !trade) && business.includes(',')) {
    const parts = business.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (!town) town = parts[parts.length - 1];
      business = parts.slice(0, -1).join(', ');
    }
  }

  if (!trade && hit && hit.trade) trade = hit.trade;
  if (!town && hit && hit.town) town = hit.town;

  return {
    placeId,
    businessName: stripLegalSuffixes(business),
    trade: stripLegalSuffixes(trade),
    town: stripLegalSuffixes(town),
    source: hit ? 'registry' : query.business || query.trade || query.town ? 'query' : 'empty',
  };
}

function pick(v) {
  const s = v == null ? '' : String(v).trim();
  return s || '';
}

export function stripLegalSuffixes(raw) {
  return String(raw || '')
    .replace(LTD_RE, '')
    .replace(/[.\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
