import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CLIENT_SITES } from './client-sites.js';
import { resolveClientSite, siteHostname } from './netlify-sites.js';
import { normalizeCheckoutPreviewSite } from '../../../shared/checkout-preview-site.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let previewConfigCache = null;

function loadPreviewConfig() {
  if (previewConfigCache) return previewConfigCache;
  try {
    const raw = readFileSync(join(__dirname, '../../../config/client-preview-sites.json'), 'utf8');
    previewConfigCache = JSON.parse(raw);
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
  return normalizeCheckoutPreviewSite(raw);
}

/**
 * Resolve HTTPS Netlify preview URL for checkout device mockups.
 * @returns {Promise<{ url: string, source: string, business?: string }|null>}
 */
export async function resolveCheckoutPreviewSiteUrl(placeId, { registry = CLIENT_SITES } = {}) {
  const id = String(placeId || '').trim();
  if (!id) return null;

  const fromReg = previewUrlFromRegistry(id, registry);
  if (fromReg) {
    const hit = registry[id];
    return { url: fromReg, source: 'registry', business: hit && hit.business };
  }

  const fromCfg = previewUrlFromConfig(id);
  if (fromCfg) return { url: fromCfg, source: 'config' };

  try {
    const site = await resolveClientSite(id, { registry });
    const host = siteHostname(site);
    const url = normalizeCheckoutPreviewSite(host ? `https://${host}/` : site.url);
    if (!url) return null;
    const hit = registry[id];
    return {
      url,
      source: site.source || 'scan',
      business: (hit && hit.business) || null,
    };
  } catch {
    return null;
  }
}
