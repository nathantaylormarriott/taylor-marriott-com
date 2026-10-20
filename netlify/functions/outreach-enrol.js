/**
 * POST /api/outreach-enrol
 * Records Day 0 time after QA approval. Does not send the message.
 */
import { outreachStore } from './_shared/inbound-store.js';
import { outreachAuthorized } from './_shared/outreach-auth.js';
import { enrolLead } from './_shared/outreach-run.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleOutreachEnrol(request, deps = {}) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const env = deps.env || process.env;
  if (!outreachAuthorized(request, env)) return json({ error: 'forbidden' }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'bad_json' }, 400);
  const result = await enrolLead(body, {
    env,
    store: deps.store || outreachStore(),
    now: deps.now,
    log: deps.log,
  });
  return json(result.body, result.status);
}

export default async (request) => handleOutreachEnrol(request);

export const config = {
  path: '/api/outreach-enrol',
};
