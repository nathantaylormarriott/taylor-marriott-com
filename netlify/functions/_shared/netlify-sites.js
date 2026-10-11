import { CLIENT_SITES } from './client-sites.js';
import { getCachedClientSite, setCachedClientSite } from './clientSiteResolveCache.js';

const NETLIFY_API = 'https://api.netlify.com/api/v1';
export const NETLIFY_TEAM_SLUG = 'nathantaylormarriott';
/** @deprecated Scan no longer filters by prefix; kept for tests/docs. */
export const CLIENT_SITE_PREFIXES = Object.freeze(['tmbulk-', 'tm-preview-']);
export const GITHUB_ORG_REPO_MARK = 'TMBULK';

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

export function linksToPlace(html, placeId) {
  const enc = encodeURIComponent(placeId);
  const re = new RegExp(`checkout[^"'\\s>]*[?&]place_id=(${escapeRe(placeId)}|${escapeRe(enc)})(?:["'&#\\s>]|$)`);
  return re.test(String(html || ''));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function siteOnTeam(site, teamSlug = NETLIFY_TEAM_SLUG) {
  return String((site && site.account_slug) || '').toLowerCase() === String(teamSlug).toLowerCase();
}

export function apiSiteToRecord(site, source) {
  return {
    siteId: site.id,
    siteName: site.name,
    url: site.ssl_url || site.url,
    customDomain: site.custom_domain || null,
    domainAliases: Array.isArray(site.domain_aliases) ? site.domain_aliases : [],
    source,
  };
}

export async function fetchHomepageHtml(siteUrl, fetchFn = fetch) {
  const res = await fetchFn(String(siteUrl || ''), {
    redirect: 'follow',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'taylor-marriott-checkout-site-verify',
    },
  });
  if (!res.ok) {
    const err = new Error(`Homepage fetch ${res.status} for ${siteUrl}`);
    err.code = 'HOMEPAGE_UNREACHABLE';
    throw err;
  }
  return res.text();
}

/**
 * Fetch a Netlify site by ID, ensure it is on our team, and confirm the homepage
 * checkout link includes this place_id.
 */
export async function verifyClientSiteForPlace(siteId, placeId, deps = {}) {
  const id = String(siteId || '').trim();
  const pid = String(placeId || '').trim();
  if (!id || !pid) {
    const err = new Error('site_id and place_id required');
    err.code = 'BAD_SITE_VERIFY_INPUT';
    throw err;
  }
  const api = deps.netlifyApi || netlifyApi;
  const fetchFn = deps.fetch || fetch;
  const site = await api(`/sites/${encodeURIComponent(id)}`);
  if (!siteOnTeam(site, deps.teamSlug)) {
    const err = new Error(`Site ${id} is not on team ${deps.teamSlug || NETLIFY_TEAM_SLUG}`);
    err.code = 'WRONG_TEAM';
    throw err;
  }
  const home = site.ssl_url || site.url;
  const html = await fetchHomepageHtml(home, fetchFn);
  if (!linksToPlace(html, pid)) {
    const err = new Error(`Site ${site.name} homepage does not link to place_id ${pid}`);
    err.code = 'PLACE_MISMATCH';
    throw err;
  }
  return apiSiteToRecord(site, 'verified');
}

/** True when the site's GitHub repo is under the bulk-websites org (informational). */
export function siteLinkedToBulkOrg(site) {
  const repo = site && site.build_settings && site.build_settings.repo_url;
  return Boolean(repo && String(repo).toUpperCase().includes(GITHUB_ORG_REPO_MARK));
}

async function scanTeamSitesForPlace(placeId, deps = {}) {
  const api = deps.netlifyApi || netlifyApi;
  const fetchFn = deps.fetch || fetch;
  const teamSlug = deps.teamSlug || NETLIFY_TEAM_SLUG;
  const matches = [];

  for (let page = 1; page <= 10; page += 1) {
    const sites = await api(`/${teamSlug}/sites?filter=all&per_page=100&page=${page}`);
    if (!Array.isArray(sites) || !sites.length) break;
    const candidates = sites;
    await Promise.all(
      candidates.map(async (s) => {
        try {
          const res = await fetchFn(s.ssl_url || s.url, {
            redirect: 'follow',
            headers: { Accept: 'text/html', 'User-Agent': 'taylor-marriott-checkout-scan' },
          });
          if (res.ok && linksToPlace(await res.text(), placeId)) matches.push(s);
        } catch {
          /* skip unreachable */
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
  return apiSiteToRecord(matches[0], 'scan');
}

/**
 * Prefer Stripe/metadata site id, else registry + scan (cached).
 */
export async function resolveSiteForOrder(order, deps = {}) {
  const placeId = order && order.placeId;
  if (order && order.netlifySiteId) {
    return verifyClientSiteForPlace(order.netlifySiteId, placeId, deps);
  }
  return resolveClientSite(placeId, deps);
}

/**
 * Find the Netlify site that belongs to this place_id.
 *   1. client-sites.js registry (confirmed via API)
 *   2. scan all team sites (~60); homepage must link checkout with this place_id (cached in Blobs)
 */
export async function resolveClientSite(placeId, { registry = CLIENT_SITES, useCache = true, deps = {} } = {}) {
  if (!placeId) {
    const err = new Error('place_id missing');
    err.code = 'NO_PLACE_ID';
    throw err;
  }

  if (useCache) {
    try {
      const cached = await getCachedClientSite(placeId, deps.cache || {});
      if (cached) return { ...cached, source: cached.source || 'cache' };
    } catch {
      /* cache optional in tests */
    }
  }

  const hit = registry[placeId];
  if (hit) {
    const api = deps.netlifyApi || netlifyApi;
    const site = await api(`/sites/${encodeURIComponent(hit.siteId)}`);
    const record = apiSiteToRecord(site, 'registry');
    try {
      await setCachedClientSite(placeId, record, deps.cache || {});
    } catch {
      /* ignore */
    }
    return record;
  }

  const record = await scanTeamSitesForPlace(placeId, deps);
  try {
    await setCachedClientSite(placeId, record, deps.cache || {});
  } catch {
    /* ignore */
  }
  return record;
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
