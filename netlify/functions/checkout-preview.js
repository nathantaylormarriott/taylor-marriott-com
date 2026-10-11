import { handleOptions } from './_shared/http.js';
import {
  buildCheckoutPreviewHtml,
  normalizeCheckoutPreviewSite,
} from './_shared/checkout-preview-build.js';

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const target = normalizeCheckoutPreviewSite(url.searchParams.get('url'));
  if (!target) {
    return new Response('Invalid or missing url', { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'taylor-marriott-checkout-preview',
      },
    });
  } catch {
    return new Response('Could not fetch preview site', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response('Preview site unavailable', { status: upstream.status === 404 ? 404 : 502 });
  }

  const html = await upstream.text();
  const body = buildCheckoutPreviewHtml(target, html);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "frame-ancestors 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    },
  });
};

export const config = {
  path: '/api/checkout-preview',
};
