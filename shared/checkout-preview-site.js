/** Normalise a client preview site URL for checkout device iframes (HTTPS Netlify app only). */

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function stripQueryHash(url) {
  url.hash = '';
  url.search = '';
  return url.toString();
}

export function normalizeCheckoutPreviewSite(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || host.endsWith('.local')) return '';
    if (!host.endsWith('.netlify.app') || host === 'netlify.app') return '';
    return stripQueryHash(url);
  } catch {
    return '';
  }
}

/**
 * Server-verified preview URLs (Netlify default URL or the site's own custom domain).
 * Used only after place_id / site_id verification — not for untrusted query params.
 */
export function normalizeVerifiedPreviewSite(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || host.endsWith('.local')) return '';
    if (!host.includes('.')) return '';
    return stripQueryHash(url);
  } catch {
    return '';
  }
}

/** Accept API-provided URLs (verified) or strict Netlify app URLs from the client. */
export function normalizeCheckoutPreviewSiteFromApi(raw) {
  return normalizeVerifiedPreviewSite(raw) || normalizeCheckoutPreviewSite(raw);
}
