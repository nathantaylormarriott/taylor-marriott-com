/**
 * GET /api/outreach-status
 * Read-only list of leads, step, next due date, and stop flags.
 */
import { outreachStore } from './_shared/inbound-store.js';
import { outreachAuthorized } from './_shared/outreach-auth.js';
import { listOutreachStatus } from './_shared/outreach-run.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleOutreachStatus(request, deps = {}) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const env = deps.env || process.env;
  if (!outreachAuthorized(request, env)) return json({ error: 'forbidden' }, 403);
  const body = await listOutreachStatus({ store: deps.store || outreachStore() });
  return json(body, 200);
}

export default async (request) => handleOutreachStatus(request);

export const config = {
  path: '/api/outreach-status',
};
