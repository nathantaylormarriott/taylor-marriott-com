import { CLIENT_SITES } from './client-sites.js';

const NETLIFY_API = 'https://api.netlify.com/api/v1';
export const NETLIFY_TEAM_SLUG = 'nathantaylormarriott';
export const CLIENT_SITE_PREFIXES = Object.freeze(['tmbulk-', 'tm-preview-']);

function requireToken() {
  const t = process.env.NETLIFY_AUTH_TOKEN;
  if (!t) {
    const err = new Error('NETLIFY_AUTH_TOKEN is not set. No Netlify API call made.');
    err.code = 'NO_NETLIFY_TOKEN';
    throw err;
  }
  return t;
}

export async function netlifyApi(pathname, { method = 'GET', body } = {}) {
  const token = requireToken();
  const res = await fetch(`${NETLIFY_API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'taylor-marriott-checkout',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`Netlify API ${res.status} ${method} ${pathname}: ${(data && data.message) || ''}`.trim());
    err.code = 'NETLIFY';
    err.status = res.status;
    throw err;
  }
  return data;
}

export function siteHostname(site) {
  if (site && site.siteName) return `${site.siteName}.netlify.app`;
  return null;
}

function linksToPlace(html, placeId) {
  const enc = encodeURIComponent(placeId);
  const re = new RegExp(`checkout[^"'\\s>]*[?&]place_id=(${escapeRe(placeId)}|${escapeRe(enc)})(?:["'&#\\s>]|$)`);
  return re.test(String(html || ''));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the Netlify site that belongs to this place_id.
 *   1. client-sites.js registry (then confirmed via the API so a stale id fails loudly)
 *   2. scan the team's tmbulk-* / tm-preview-* sites; the live homepage must link to
 *      the checkout with exactly this place_id. More than one match = refuse.
 */
export async function resolveClientSite(placeId, { registry = CLIENT_SITES } = {}) {
  if (!placeId) {
    const err = new Error('place_id missing');
    err.code = 'NO_PLACE_ID';
    throw err;
  }
  const hit = registry[placeId];
  if (hit) {
    const site = await netlifyApi(`/sites/${encodeURIComponent(hit.siteId)}`);
    return {
      siteId: site.id,
      siteName: site.name,
      url: site.ssl_url || site.url,
      customDomain: site.custom_domain || null,
      domainAliases: Array.isArray(site.domain_aliases) ? site.domain_aliases : [],
      source: 'registry',
    };
  }

  const matches = [];
  for (let page = 1; page <= 10; page += 1) {
    const sites = await netlifyApi(
      `/${NETLIFY_TEAM_SLUG}/sites?filter=all&per_page=100&page=${page}`,
    );
    if (!Array.isArray(sites) || !sites.length) break;
    const candidates = sites.filter((s) => CLIENT_SITE_PREFIXES.some((p) => String(s.name).startsWith(p)));
    await Promise.all(
      candidates.map(async (s) => {
        try {
          const res = await fetch(s.ssl_url || s.url, { redirect: 'follow' });
          if (res.ok && linksToPlace(await res.text(), placeId)) matches.push(s);
        } catch {
          /* unreachable site: skip */
        }
      }),
    );
    if (sites.length < 100) break;
  }
  if (matches.length !== 1) {
    const err = new Error(
      matches.length
        ? `More than one Netlify site links to place_id ${placeId}: ${matches.map((s) => s.name).join(', ')}`
        : `No Netlify site found for place_id ${placeId}`,
    );
    err.code = matches.length ? 'AMBIGUOUS_SITE' : 'NO_SITE';
    throw err;
  }
  const s = matches[0];
  return {
    siteId: s.id,
    siteName: s.name,
    url: s.ssl_url || s.url,
    customDomain: s.custom_domain || null,
    domainAliases: Array.isArray(s.domain_aliases) ? s.domain_aliases : [],
    source: 'scan',
  };
}

/** Build (never send) the PATCH that sets the custom domain + www alias. */
export function buildAttachDomainRequest(site, apex) {
  const www = `www.${apex}`;
  const aliases = [...new Set([...(site.domainAliases || []), www])];
  return {
    method: 'PATCH',
    url: `${NETLIFY_API}/sites/${site.siteId}`,
    path: `/sites/${site.siteId}`,
    body: { custom_domain: apex, domain_aliases: aliases },
  };
}

export function buildProvisionSslRequest(site) {
  return { method: 'POST', url: `${NETLIFY_API}/sites/${site.siteId}/ssl`, path: `/sites/${site.siteId}/ssl`, body: null };
}

export { linksToPlace as _linksToPlace };
