import { SEARCH_DEFAULT_TLDS } from './domain-search-input.js';

/** Label variants when the user's first choice is taken. */
export function closeAlternativeLabels(baseLabel) {
  const b = String(baseLabel || '').trim().toLowerCase();
  if (!b) return [];
  const out = [];
  const push = (label) => {
    if (!label || label === b || label.length < 3 || label.length > 63) return;
    if (label.startsWith('-') || label.endsWith('-')) return;
    if (!/^[a-z0-9-]+$/.test(label)) return;
    if (!out.includes(label)) out.push(label);
  };
  push(`${b}uk`);
  push(`${b}-online`);
  push(`get${b}`);
  push(`${b}-site`);
  push(`${b}web`);
  push(`${b}-co`);
  push(`${b}-ltd`);
  return out.slice(0, 10);
}

export function domainsForLabels(labels, tlds = SEARCH_DEFAULT_TLDS) {
  const domains = [];
  for (const label of labels) {
    for (const tld of tlds) {
      domains.push(`${label}.${tld}`);
      if (domains.length >= 24) return domains;
    }
  }
  return domains;
}
