/** Shared checkout domain search normalisation + validation (client + Netlify functions). */

export const SEARCH_DEFAULT_TLDS = Object.freeze(['co.uk', 'com', 'uk']);

const MULTI_TLDS = ['co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'org.uk'];
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const FRIENDLY = {
  empty: 'Enter a domain name or paste a web address.',
  labelChars: 'Use only letters, numbers and hyphens in the name.',
  labelHyphen: 'Names cannot start or end with a hyphen.',
  labelLength: 'That name is too long (max 63 characters per part).',
  labelShort: 'Enter at least 2 characters.',
  domainFormat: 'That does not look like a valid domain (e.g. mybusiness.co.uk).',
  tld: 'That domain ending is not supported here — try .co.uk, .com or .uk.',
};

export function stripSearchNoise(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/\s+/g, '');
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/\.$/, '');
  return s;
}

export function splitApex(domain) {
  const d = stripSearchNoise(domain);
  if (!d.includes('.')) return { label: d, tld: null };
  for (const t of MULTI_TLDS) {
    if (d === t || d.endsWith(`.${t}`)) {
      return { label: d.slice(0, -(t.length + 1)), tld: t };
    }
  }
  const i = d.lastIndexOf('.');
  if (i <= 0) return { label: d, tld: null };
  return { label: d.slice(0, i), tld: d.slice(i + 1) };
}

export function validateLabel(label) {
  if (!label) return { ok: false, code: 'empty', message: FRIENDLY.empty };
  if (label.length < 2) return { ok: false, code: 'short', message: FRIENDLY.labelShort };
  if (label.length > 63) return { ok: false, code: 'length', message: FRIENDLY.labelLength };
  if (label.startsWith('-') || label.endsWith('-')) {
    return { ok: false, code: 'hyphen', message: FRIENDLY.labelHyphen };
  }
  if (!LABEL_RE.test(label)) return { ok: false, code: 'chars', message: FRIENDLY.labelChars };
  return { ok: true };
}

export function validateApexDomain(domain, { allowedTlds = SEARCH_DEFAULT_TLDS } = {}) {
  const cleaned = stripSearchNoise(domain);
  if (!cleaned.includes('.')) {
    return validateLabel(cleaned);
  }
  const { label, tld } = splitApex(cleaned);
  const labelCheck = validateLabel(label);
  if (!labelCheck.ok) return labelCheck;
  if (!tld || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(tld)) {
    return { ok: false, code: 'format', message: FRIENDLY.domainFormat };
  }
  if (Array.isArray(allowedTlds) && allowedTlds.length && !allowedTlds.includes(tld)) {
    return { ok: false, code: 'tld', message: FRIENDLY.tld };
  }
  const full = `${label}.${tld}`;
  if (full.length > 253) return { ok: false, code: 'length', message: FRIENDLY.labelLength };
  return { ok: true, domain: full, label, tld };
}

/**
 * @returns {{ ok: boolean, message?: string, code?: string, mode: 'label'|'domain', label: string, domain?: string, tlds: string[] }}
 */
export function parseSearchInput(raw, { allowedTlds = SEARCH_DEFAULT_TLDS } = {}) {
  const cleaned = stripSearchNoise(raw);
  if (!cleaned) {
    return { ok: false, mode: 'label', label: '', tlds: [...allowedTlds], ...validateLabel('') };
  }

  if (!cleaned.includes('.')) {
    const label = cleaned.replace(/&/g, 'and').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const v = validateLabel(label);
    return {
      ok: v.ok,
      message: v.message,
      code: v.code,
      mode: 'label',
      label,
      tlds: [...allowedTlds],
    };
  }

  const { label, tld } = splitApex(cleaned);
  const safeLabel = label.replace(/&/g, 'and').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const v = validateApexDomain(`${safeLabel}.${tld}`, { allowedTlds: null });
  if (!v.ok) {
    return { ok: false, mode: 'domain', label: safeLabel, tlds: [tld], message: v.message, code: v.code };
  }
  const domain = `${safeLabel}.${tld}`;
  const tldAllowed = !allowedTlds?.length || allowedTlds.includes(tld);
  if (!tldAllowed) {
    return { ok: false, mode: 'domain', label: safeLabel, domain, tlds: [tld], code: 'tld', message: FRIENDLY.tld };
  }
  return { ok: true, mode: 'domain', label: safeLabel, domain, tlds: [tld] };
}

export function primaryDomainForParsed(parsed) {
  if (!parsed.ok) return null;
  if (parsed.mode === 'domain' && parsed.domain) return parsed.domain;
  if (parsed.mode === 'label' && parsed.label) return `${parsed.label}.co.uk`;
  return null;
}
