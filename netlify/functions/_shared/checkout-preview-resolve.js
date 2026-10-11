import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIENT_SITES } from './client-sites.js';
import { resolveClientSite, verifyClientSiteForPlace } from './netlify-sites.js';
import {
  normalizeCheckoutPreviewSite,
  normalizeVerifiedPreviewSite,
} from '../../../shared/checkout-preview-site.js';

/** Not named __dirname — Netlify's ESM bundle injects its own __dirname shim. */
const CLIENT_PREVIEW_CONFIG_PATH = fileURLToPath(
  new URL('../../../config/client-preview-sites.json', import.meta.url),
);

let previewConfigCache = null;

function loadPreviewConfig() {
  if (previewConfigCache) return previewConfigCache;
  try {
    previewConfigCache = JSON.parse(fs.readFileSync(CLIENT_PREVIEW_CONFIG_PATH, 'utf8'));
  } catch {
    previewConfigCache = {};
  }
  return previewConfigCache;
}

export function previewUrlFromRegistry(placeId, registry = CLIENT_SITES) {
  const hit = registry[placeId];
  if (!hit || !hit.siteName) return '';
  return normalizeCheckoutPreviewSite(`https://${hit.siteName}.netlify.app/`);
}

export function previewUrlFromConfig(placeId, config = loadPreviewConfig()) {
  const raw = config && config[placeId];
  if (typeof raw !== 'string') return '';
  return normalizeVerifiedPreviewSite(raw) || normalizeCheckoutPreviewSite(raw);
}

export function previewUrlFromSiteRecord(site) {
  if (!site) return '';
  const fromUrl = normalizeVerifiedPreviewSite(site.url);
  if (fromUrl) return fromUrl;
  if (site.siteName) return normalizeCheckoutPreviewSite(`https://${site.siteName}.netlify.app/`);
  return '';
}

/**
 * Resolve HTTPS preview URL for checkout device mockups.
 * @returns {Promise<{ url: string, source: string, business?: string, siteId?: string }|null>}
 */
export async function resolveCheckoutPreviewSiteUrl(placeId, opts = {}) {
  const id = String(placeId || '').trim();
  if (!id) return null;
  const registry = opts.registry || CLIENT_SITES;
  const deps = opts.deps || {};

  const siteIdParam = String(opts.siteId || '').trim();
  if (siteIdParam) {
    try {
      const verified = await verifyClientSiteForPlace(siteIdParam, id, deps);
      const url = previewUrlFromSiteRecord(verified);
      if (!url) return null;
      const hit = registry[id];
      return {
        url,
        source: 'verified',
        siteId: verified.siteId,
        business: (hit && hit.business) || null,
      };
    } catch {
      return null;
    }
  }

  const fromReg = previewUrlFromRegistry(id, registry);
  if (fromReg) {
    const hit = registry[id];
    return { url: fromReg, source: 'registry', business: hit && hit.business, siteId: hit && hit.siteId };
  }

  const fromCfg = previewUrlFromConfig(id);
  if (fromCfg) return { url: fromCfg, source: 'config' };

  try {
    const site = await resolveClientSite(id, { registry, deps });
    const url = previewUrlFromSiteRecord(site);
    if (!url) return null;
    const hit = registry[id];
    return {
      url,
      source: site.source || 'scan',
      siteId: site.siteId,
      business: (hit && hit.business) || null,
    };
  } catch {
    return null;
  }
}
