const API = 'https://api.porkbun.com/api/json/v3';
export const DEFAULT_TLDS = Object.freeze(['com', 'co.uk', 'uk', 'net', 'org']);
export const BULK_CHECK_MAX = 25;

function missingCredentialNames() {
  const missing = [];
  if (!process.env.PORKBUN_API_KEY) missing.push('PORKBUN_API_KEY');
  if (!process.env.PORKBUN_SECRET_API_KEY) missing.push('PORKBUN_SECRET_API_KEY');
  return missing;
}

function requireCredentials() {
  const missing = missingCredentialNames();
  if (missing.length) {
    const err = new Error(`Porkbun credentials missing (${missing.join(', ')}). No API call made.`);
    err.code = 'NO_PORKBUN';
    err.missing = missing;
    throw err;
  }
  return {
    apikey: process.env.PORKBUN_API_KEY,
    secretapikey: process.env.PORKBUN_SECRET_API_KEY,
  };
}

export function normalizeDomain(domain) {
  let d = String(domain || '').trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0].split('?')[0].split('#')[0];
  d = d.replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) {
    const err = new Error(`Not an apex domain: ${domain}`);
    err.code = 'BAD_DOMAIN';
    throw err;
  }
  return d;
}

export function toDomainLabel(baseName) {
  let s = String(baseName || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.replace(/&/g, 'and');
  s = s.replace(/[^a-z0-9-]+/g, '');
  s = s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!s || s.length > 63) {
    const err = new Error(`Cannot make a domain label from: ${baseName}`);
    err.code = 'BAD_DOMAIN';
    throw err;
  }
  return s;
}

function normalizeTld(tld) {
  const t = String(tld || '').trim().toLowerCase().replace(/^\.+/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(t)) {
    const err = new Error(`Bad TLD: ${tld}`);
    err.code = 'BAD_TLD';
    throw err;
  }
  return t;
}

export function buildCandidateDomains(baseName, tlds = DEFAULT_TLDS) {
  const label = toDomainLabel(baseName);
  const list = (tlds && tlds.length ? tlds : DEFAULT_TLDS).map(normalizeTld);
  return [...new Set(list.map((t) => normalizeDomain(`${label}.${t}`)))];
}

function isAvailable(value) {
  if (value === true) return true;
  const v = String(value == null ? '' : value).toLowerCase();
  return v === 'yes' || v === 'available' || v === '1' || v === 'true';
}

function isPremium(value) {
  if (value === true) return true;
  const v = String(value == null ? '' : value).toLowerCase();
  return v === 'yes' || v === '1' || v === 'true';
}

function summarizeResponse(domain, response, status) {
  const r = response && typeof response === 'object' ? response : {};
  return {
    domain,
    status: status || null,
    available: r.avail == null ? null : isAvailable(r.avail),
    avail: r.avail ?? null,
    price: r.price ?? null,
    regularPrice: r.regularPrice ?? null,
    premium: r.premium == null ? null : isPremium(r.premium),
    minDuration: r.minDuration ?? null,
    renewalPrice: (r.additional && r.additional.renewal && r.additional.renewal.price) ?? null,
  };
}

function summarizeCheck(domain, data) {
  return summarizeResponse(domain, data && data.response, data && data.status);
}

async function porkbunPost(pathname, extraBody, { headers = {} } = {}) {
  const creds = requireCredentials();
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'taylor-marriott-checkout',
      ...headers,
    },
    body: JSON.stringify({
      ...extraBody,
      apikey: creds.apikey,
      secretapikey: creds.secretapikey,
    }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || (data && data.status && data.status !== 'SUCCESS')) {
    const msg = (data && data.message) || `Porkbun API ${res.status} ${pathname}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = 'PORKBUN';
    err.porkbunCode = (data && data.code) || null;
    throw err;
  }
  return data;
}

export async function checkDomain(domain) {
  const apex = normalizeDomain(domain);
  const data = await porkbunPost(`/domain/checkDomain/${encodeURIComponent(apex)}`, {});
  return summarizeCheck(apex, data);
}

export async function checkDomains(baseName, tlds = DEFAULT_TLDS) {
  const domains = buildCandidateDomains(baseName, tlds);
  if (domains.length > BULK_CHECK_MAX) {
    const err = new Error(`At most ${BULK_CHECK_MAX} domains per check (got ${domains.length})`);
    err.code = 'TOO_MANY_DOMAINS';
    throw err;
  }
  const data = await porkbunPost('/domain/checkDomain', { domains });
  const answered = data && data.domains && typeof data.domains === 'object' ? data.domains : {};
  const unresolved = new Set(Array.isArray(data && data.unresolved) ? data.unresolved : []);
  const invalidList = Array.isArray(data && data.invalid) ? data.invalid : [];
  const invalid = new Map(
    invalidList.map((x) => [String((x && (x.domain || x.name)) || x).toLowerCase(), x]),
  );
  const results = domains.map((d) => {
    if (answered[d]) return { ...summarizeResponse(d, answered[d], 'SUCCESS'), state: 'answered' };
    if (unresolved.has(d)) return { domain: d, available: null, price: null, state: 'unresolved' };
    if (invalid.has(d)) {
      const inv = invalid.get(d);
      return {
        domain: d,
        available: null,
        price: null,
        state: 'invalid',
        reason: (inv && (inv.reason || inv.message)) || null,
      };
    }
    return { domain: d, available: null, price: null, state: 'missing' };
  });
  return {
    baseName: toDomainLabel(baseName),
    tlds: (tlds && tlds.length ? tlds : DEFAULT_TLDS).map(normalizeTld),
    results,
  };
}

export async function getTldPricing(tlds = null) {
  const res = await fetch(`${API}/pricing/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'taylor-marriott-checkout' },
    body: '{}',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.status !== 'SUCCESS' || !data.pricing) {
    const err = new Error((data && data.message) || `Porkbun API ${res.status} /pricing/get`);
    err.status = res.status;
    err.code = 'PORKBUN';
    throw err;
  }
  const want = tlds && tlds.length ? tlds.map(normalizeTld) : Object.keys(data.pricing);
  const out = {};
  for (const t of want) {
    const row = data.pricing[t];
    out[t] = row
      ? { registration: row.registration ?? null, renewal: row.renewal ?? null, transfer: row.transfer ?? null }
      : { registration: null, renewal: null, transfer: null };
  }
  return out;
}
