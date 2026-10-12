import { readShortLink } from './_shared/short-link.js';

function idFrom(request, context) {
  const fromContext = context && context.params && context.params.id;
  if (fromContext) return fromContext;
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  return parts[0] === 'p' ? parts[1] : '';
}

/** GET /p/:id -> Stripe hosted invoice or customer portal. */
export default async (request, context) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const target = await readShortLink(idFrom(request, context));
  if (!target) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
};

export const config = {
  path: '/p/:id',
};
