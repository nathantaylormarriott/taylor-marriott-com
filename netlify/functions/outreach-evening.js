/**
 * Day 3 and Day 10. Cron is UTC, so it fires at 18:00 UTC (19:00 BST) and
 * 19:00 UTC (19:00 GMT), every day including weekends. The handler sends only
 * when the Europe/London hour is 19.
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

export async function handleOutreachEvening(request, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now() : new Date();
  const hour = londonHour(now);
  if (hour !== SEND_HOUR_LONDON) {
    console.log(`[outreach-evening] skip. London hour is ${hour}. Follow-ups run at 19:00 Europe/London.`);
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
    onlyDays: [3, 10],
  });
  return json(result);
}

export default async (request) => handleOutreachEvening(request);

export const config = {
  schedule: '0 18,19 * * *',
};
