import { readSession } from './_shared/pipelineAuth.js';
import {
  cleanCardId,
  deleteLogo,
  isLogoContentType,
  readLogo,
  writeLogo,
} from './_shared/pipelineLogos.js';
import { jsonResponse } from './_shared/http.js';

const ORIGINS = new Set([
  'https://taylor-marriott.com',
  'http://localhost:5274',
  'http://localhost:5275',
  'http://127.0.0.1:5274',
  'http://127.0.0.1:5275',
  'http://192.168.1.88:5173',
  'http://192.168.1.88:5274',
  'http://192.168.1.88:5275',
]);

function cors(request) {
  const origin = request.headers.get('origin') || '';
  const allowOrigin = ORIGINS.has(origin) ? origin : 'https://taylor-marriott.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pipeline',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    Vary: 'Origin',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  };
}

export default async (request, context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(request) });
  }

  const cardId = cleanCardId(context.params?.cardId);
  if (!cardId) {
    return jsonResponse(request, { error: 'Invalid card.' }, 400, cors(request));
  }

  if (!readSession(request)) {
    return jsonResponse(request, { error: 'Sign in required.' }, 401, cors(request));
  }

  try {
    if (request.method === 'GET') {
      const logo = await readLogo(cardId);
      if (!logo) return new Response(null, { status: 404, headers: cors(request) });
      return new Response(logo.data, {
        status: 200,
        headers: {
          ...cors(request),
          'Content-Type': logo.contentType,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    if (request.method === 'POST') {
      if (request.headers.get('x-pipeline') !== '1') {
        return jsonResponse(request, { error: 'Method not allowed' }, 405, cors(request));
      }
      const contentType = (request.headers.get('content-type') || '').split(';')[0].trim();
      if (!isLogoContentType(contentType)) {
        return jsonResponse(request, { error: 'Use a JPEG, PNG, WebP, or GIF under 512 KB.' }, 400, cors(request));
      }
      const buffer = await request.arrayBuffer();
      await writeLogo(cardId, buffer, contentType);
      return jsonResponse(request, { ok: true, hasLogo: true }, 200, cors(request));
    }

    if (request.method === 'DELETE') {
      await deleteLogo(cardId);
      return jsonResponse(request, { ok: true, hasLogo: false }, 200, cors(request));
    }

    return jsonResponse(request, { error: 'Method not allowed' }, 405, cors(request));
  } catch (error) {
    console.error('[pipeline-logo]', error?.message || error);
    const message = error?.message?.includes('512 KB') || error?.message?.includes('Unsupported')
      ? error.message
      : 'Logo upload failed.';
    return jsonResponse(request, { error: message }, 400, cors(request));
  }
};

export const config = {
  path: '/api/pipeline/logo/:cardId',
  method: ['GET', 'POST', 'DELETE', 'OPTIONS'],
};
