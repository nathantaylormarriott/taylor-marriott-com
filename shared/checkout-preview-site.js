/** Normalise a client preview site URL for checkout device iframes (HTTPS Netlify app only). */

export function normalizeCheckoutPreviewSite(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (!host.endsWith('.netlify.app') || host === 'netlify.app') return '';
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}
