import { CHECKOUT_PREVIEW_SCROLL_SCRIPT } from '../../../shared/checkout-preview-scroll.js';
import { normalizeCheckoutPreviewSite } from '../../../shared/checkout-preview-site.js';

export { normalizeCheckoutPreviewSite };

export function buildCheckoutPreviewHtml(pageUrl, html) {
  const base = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`;
  let out = String(html || '');
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<base\b[^>]*>/gi, '');
  const inject = `<base href="${base}">${CHECKOUT_PREVIEW_SCROLL_SCRIPT}`;
  if (/<head(\s[^>]*)?>/i.test(out)) {
    out = out.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${inject}`);
  } else {
    out = inject + out;
  }
  return out;
}
