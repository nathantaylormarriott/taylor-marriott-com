import { handleOptions, jsonResponse } from './_shared/http.js';
import { resolveCheckoutPreviewSiteUrl } from './_shared/checkout-preview-resolve.js';

const PLACE_ID_RE = /^[^\s?#&=]{6,256}$/;

export default async (request) => {
  if (request.method === 'OPTIONS') return handleOptions(request);
  if (request.method !== 'GET') {
    return jsonResponse(request, { error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const placeId = String(url.searchParams.get('place_id') || '').trim();
  if (!placeId || !PLACE_ID_RE.test(placeId)) {
    return jsonResponse(request, { error: 'Invalid place_id' }, 400);
  }

  try {
    const hit = await resolveCheckoutPreviewSiteUrl(placeId);
    if (!hit || !hit.url) {
      return jsonResponse(request, { url: null, placeId }, 404, { 'Cache-Control': 'public, max-age=300' });
    }
    return jsonResponse(
      request,
      { url: hit.url, source: hit.source, business: hit.business || null, placeId },
      200,
      { 'Cache-Control': 'public, max-age=300' },
    );
  } catch (err) {
    console.error('[client-preview-site]', placeId, err.message);
    return jsonResponse(request, { url: null, placeId }, 404);
  }
};

export const config = {
  path: '/api/client-preview-site',
};
