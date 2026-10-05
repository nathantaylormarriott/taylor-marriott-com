import {
  clearSessionCookie,
  clientKey,
  createSession,
  hasPipelineHeader,
  pipelineEnv,
  readSession,
  sessionCookie,
  verifyPassword,
} from './_shared/pipelineAuth.js';
import {
  clearFailures,
  ensureDevTables,
  loginState,
  readBoard,
  recordFailure,
  sanitizeBoard,
  writeBoard,
} from './_shared/pipelineStore.js';
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

function pipelineJson(request, body, status = 200, extraHeaders = {}) {
  const origin = request.headers.get('origin') || '';
  const allowOrigin = ORIGINS.has(origin) ? origin : 'https://taylor-marriott.com';
  return jsonResponse(request, body, status, {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pipeline',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    ...extraHeaders,
  });
}

function configured() {
  return Boolean(pipelineEnv('PIPELINE_PASSWORD_HASH') && pipelineEnv('PIPELINE_SESSION_SECRET'));
}

export default async (request, context) => {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('origin') || '';
    const allowOrigin = ORIGINS.has(origin) ? origin : 'https://taylor-marriott.com';
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type, X-Pipeline',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        Vary: 'Origin',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, '');

  if (!configured()) {
    return pipelineJson(request, { error: 'Pipeline is not configured.' }, 503);
  }

  try {
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '192.168.1.88') {
      await ensureDevTables();
    }

    if (route.endsWith('/login')) {
      if (request.method !== 'POST' || !hasPipelineHeader(request)) {
        return pipelineJson(request, { error: 'Method not allowed' }, 405);
      }
      const ipHash = clientKey(request, context);
      const state = await loginState(ipHash);
      if (state.locked) {
        return pipelineJson(request, { error: 'Too many attempts. Try again in a few minutes.' }, 429);
      }
      const body = await request.json().catch(() => ({}));
      const password = typeof body.password === 'string' ? body.password : '';
      const ok = verifyPassword(password, pipelineEnv('PIPELINE_PASSWORD_HASH'));
      if (!ok) {
        const locked = await recordFailure(ipHash);
        return pipelineJson(
          request,
          { error: locked ? 'Too many attempts. Try again in a few minutes.' : 'Incorrect password.' },
          locked ? 429 : 401,
        );
      }
      await clearFailures(ipHash);
      return pipelineJson(request, { ok: true }, 200, {
        'Set-Cookie': sessionCookie(createSession(), request),
      });
    }

    if (route.endsWith('/logout')) {
      if (request.method !== 'POST') {
        return pipelineJson(request, { error: 'Method not allowed' }, 405);
      }
      return pipelineJson(request, { ok: true }, 200, {
        'Set-Cookie': clearSessionCookie(request),
      });
    }

    if (!readSession(request)) {
      return pipelineJson(request, { error: 'Sign in required.' }, 401);
    }

    if (request.method === 'GET') {
      return pipelineJson(request, { board: await readBoard() });
    }

    if (request.method === 'PUT') {
      if (!hasPipelineHeader(request)) {
        return pipelineJson(request, { error: 'Method not allowed' }, 405);
      }
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return pipelineJson(request, { error: 'Invalid board.' }, 400);
      }
      const board = await writeBoard(sanitizeBoard(body.board ?? body));
      return pipelineJson(request, { board });
    }

    return pipelineJson(request, { error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('[pipeline]', error?.message || error);
    return pipelineJson(request, { error: 'Pipeline is unavailable.' }, 500);
  }
};

export const config = {
  path: ['/api/pipeline', '/api/pipeline/login', '/api/pipeline/logout'],
  method: ['GET', 'PUT', 'POST', 'OPTIONS'],
};
