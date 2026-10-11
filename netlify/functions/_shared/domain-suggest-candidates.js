import { toDomainLabel } from './porkbun-client.js';

const SUGGEST_TLDS = Object.freeze(['co.uk', 'com', 'uk']);
const MAX_LABELS = 6;
const MAX_DOMAINS = 15;

/** Strip Ltd/Limited, punctuation; keep words for initials. */
export function cleanBusinessWords(raw) {
  let s = String(raw || '').trim();
  if (!s) return [];
  s = s.replace(/\b(l\.?\s?l\.?\s?p\.?|ltd\.?|limited|plc)\b/gi, ' ');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/['']/g, '');
  s = s.replace(/[^\w\s-]+/g, ' ');
  return s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

export function labelFromParts(...parts) {
  let merged = parts
    .flatMap((p) => String(p || '').split(/\s+/))
    .join('');
  merged = merged.replace(/&/g, 'and');
  try {
    return toDomainLabel(merged);
  } catch {
    return '';
  }
}

/**
 * Build ~10–15 domain names (labels × co.uk / com / uk) from business context.
 */
export function generateDomainLabelCandidates(ctx = {}) {
  const words = cleanBusinessWords(ctx.businessName);
  const tradeWords = cleanBusinessWords(ctx.trade);
  const townWords = cleanBusinessWords(ctx.town);

  const nameLabel = labelFromParts(...words);
  const tradeLabel = labelFromParts(...tradeWords);
  const townLabel = labelFromParts(...townWords);

  const labels = [];
  const push = (label, reason) => {
    if (!label || label.length < 3) return;
    if (labels.some((x) => x.label === label)) return;
    labels.push({ label, reason });
  };

  if (nameLabel) push(nameLabel, 'business');
  if (nameLabel && townLabel) push(labelFromParts(nameLabel, townLabel), 'name+town');
  if (nameLabel && tradeLabel) push(labelFromParts(nameLabel, tradeLabel), 'name+trade');
  if (tradeLabel && townLabel) push(labelFromParts(tradeLabel, townLabel), 'trade+town');

  const initials = words.map((w) => w[0]).join('');
  if (initials.length >= 2 && tradeLabel && townLabel) {
    push(labelFromParts(initials, tradeLabel, townLabel), 'initials+trade+town');
  }
  if (initials.length >= 2 && townLabel) {
    push(labelFromParts(initials, townLabel), 'initials+town');
  }

  // "and" merged variant (sandr vs sandr from s and r)
  const mergedNoAnd = labelFromParts(words.join('').replace(/and/gi, ''));
  if (mergedNoAnd && mergedNoAnd !== nameLabel) push(mergedNoAnd, 'business-compact');

  if (nameLabel && tradeLabel && townLabel) {
    push(labelFromParts(nameLabel, tradeLabel, townLabel), 'name+trade+town');
  }

  return labels.slice(0, MAX_LABELS);
}

export function expandLabelsToDomains(labelEntries, tlds = SUGGEST_TLDS) {
  const domains = [];
  for (const { label, reason } of labelEntries) {
    for (const tld of tlds) {
      if (domains.length >= MAX_DOMAINS) break;
      const domain = `${label}.${tld}`;
      if (!domains.some((d) => d.domain === domain)) {
        domains.push({ domain, label, tld, reason });
      }
    }
  }
  return domains;
}

export function generateSuggestionDomainCandidates(ctx = {}) {
  const labels = generateDomainLabelCandidates(ctx);
  return expandLabelsToDomains(labels);
}

export { SUGGEST_TLDS, MAX_DOMAINS };
