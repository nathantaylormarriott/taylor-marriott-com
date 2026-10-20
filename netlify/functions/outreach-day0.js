/**
 * Picks up a Day 0 that was not recorded at enrolment. Every 10 minutes, any
 * hour. Enrolment still sends Day 0 immediately. This does not send Day 3 or
 * Day 10.
 */
import { outreachStore } from './_shared/inbound-store.js';
import { runOutreachDay } from './_shared/outreach-run.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleOutreachDay0(request, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : new Date();
  const result = await runOutreachDay({
    env: deps.env || process.env,
    store: deps.store || outreachStore(),
    now,
    fetchImpl: deps.fetchImpl,
    sendMail: deps.sendMail,
    log: deps.log,
    whatsappDailyLimit: deps.whatsappDailyLimit,
    onlyDays: [0],
  });
  return json(result);
}

export default async (request) => handleOutreachDay0(request);

export const config = {
  schedule: '*/10 * * * *',
};
