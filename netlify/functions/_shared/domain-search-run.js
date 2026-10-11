import { parseSearchInput, primaryDomainForParsed, SEARCH_DEFAULT_TLDS } from '../../../shared/domain-search-input.js';
import { closeAlternativeLabels, domainsForLabels } from '../../../shared/domain-search-alternatives.js';
import { checkDomainList, checkDomains } from './porkbun-client.js';
import { porkbunRowToSearchResult } from './domainSearchMap.js';
import { filterSuggestionChecks } from './domain-suggest-filter.js';

export function parseCheckoutSearchQuery(raw) {
  return parseSearchInput(raw, { allowedTlds: SEARCH_DEFAULT_TLDS });
}

export async function runDomainSearch(raw, config, { getTldPricing }) {
  const parsed = parseCheckoutSearchQuery(raw);
  if (!parsed.ok) {
    const err = new Error(parsed.message || 'Invalid search');
    err.code = parsed.code || 'BAD_SEARCH';
    err.friendly = true;
    throw err;
  }

  const tldPricing = await getTldPricing(
    parsed.mode === 'label' ? SEARCH_DEFAULT_TLDS : parsed.tlds,
  );

  let checkRows;
  let queryLabel = parsed.label;

  if (parsed.mode === 'label') {
    const check = await checkDomains(parsed.label, SEARCH_DEFAULT_TLDS);
    queryLabel = check.baseName;
    checkRows = check.results;
  } else {
    const check = await checkDomainList([parsed.domain]);
    checkRows = check.results;
  }

  const results = checkRows.map((row) => porkbunRowToSearchResult(row, tldPricing, config));

  const primaryDomain = primaryDomainForParsed(parsed);
  const primary = primaryDomain ? results.find((r) => r.domain === primaryDomain) : null;
  let alternatives = [];

  if (primary && primary.state === 'taken') {
    const altLabels = closeAlternativeLabels(parsed.label);
    const toCheck = domainsForLabels(altLabels, SEARCH_DEFAULT_TLDS);
    if (toCheck.length) {
      const altCheck = await checkDomainList(toCheck);
      alternatives = filterSuggestionChecks(altCheck.results, tldPricing, config).slice(0, 3);
    }
  }

  return {
    parsed: { mode: parsed.mode, label: queryLabel, domain: parsed.domain || null },
    query: queryLabel,
    results,
    alternatives,
    primaryDomain,
  };
}
