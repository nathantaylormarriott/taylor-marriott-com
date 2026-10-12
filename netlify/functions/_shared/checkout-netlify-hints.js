import { CLIENT_SITES } from './client-sites.js';
import { verifyClientSiteForPlace } from './netlify-sites.js';

const SITE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNetlifySiteId(value) {
  return SITE_ID_RE.test(String(value || '').trim());
}

/**
 * Netlify site id/name for Stripe metadata (verified site_id or registry).
 * @returns {Promise<{ netlifySiteId?: string, netlifySiteName?: string }>}
 */
export async function resolveNetlifyHintsForCheckout(placeId, siteIdFromClient, deps = {}) {
  const siteId = String(siteIdFromClient || '').trim();
  if (siteId) {
    if (!isNetlifySiteId(siteId)) {
      const err = new Error('Invalid site_id');
      err.code = 'BAD_SITE_ID';
      throw err;
    }
    const site = await verifyClientSiteForPlace(siteId, placeId, deps);
    return { netlifySiteId: site.siteId, netlifySiteName: site.siteName };
  }
  const hit = CLIENT_SITES[placeId];
  if (hit && hit.siteId) {
    return { netlifySiteId: hit.siteId, netlifySiteName: hit.siteName };
  }
  return {};
}
