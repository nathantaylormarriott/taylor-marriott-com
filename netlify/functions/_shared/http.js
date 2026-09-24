const SITE_ORIGINS = [
  'https://taylor-marriott.com',
  'http://localhost:5274',
  'http://localhost:5275',
  'http://127.0.0.1:5274',
  'http://127.0.0.1:5275',
  'http://192.168.1.88:5274',
  'http://192.168.1.88:5275',
];

export function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allowOrigin = SITE_ORIGINS.includes(origin) ? origin : SITE_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

export function jsonResponse(request, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

export function handleOptions(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
