/**
 * Daily send. Cron is UTC, so it fires at 09:00 UTC (10:00 BST) and 10:00 UTC
 * (10:00 GMT). The handler sends only when the Europe/London hour is 10, which
 * is one window per day in both GMT and BST.
 */
import { outreachStore } from './_shared/inbound-store.js';
import { runOutreachDay } from './_shared/outreach-run.js';
import { londonHour, SEND_HOUR_LONDON } from '../../shared/outreach-sequence.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleOutreachDaily(request, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : new Date();
  const hour = londonHour(now);
  if (hour !== SEND_HOUR_LONDON) {
    console.log(`[outreach-daily] skip. London hour is ${hour}. Sends run at 10:00 Europe/London.`);
    return json({ ok: true, skipped: 'outside-london-hour', londonHour: hour });
  }
  const result = await runOutreachDay({
    env: deps.env || process.env,
    store: deps.store || outreachStore(),
    now,
    fetchImpl: deps.fetchImpl,
    sendMail: deps.sendMail,
    log: deps.log,
    whatsappDailyLimit: deps.whatsappDailyLimit,
  });
  return json(result);
}

export default async (request) => handleOutreachDaily(request);

export const config = {
  schedule: '0 9,10 * * *',
};
