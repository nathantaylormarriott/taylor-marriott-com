/**
 * Day 0 / Day 3 / Day 10 timing and copy checks.
 * Calendar days are Europe/London, so GMT and BST do not shift the due date.
 * SMS stays inside the 159 GSM-7 septet cap. Nothing here appends an opt-out line.
 */
import { DateTime } from 'luxon';
import outreachCopy from '../config/outreach-copy.json' with { type: 'json' };
import { gsmSeptetLength, SMS_SEPTET_LIMIT } from './sms-gsm.js';

export const LONDON = 'Europe/London';
export const STEP_DAYS = [0, 3, 10];
export const WHATSAPP_DAILY_LIMIT = 250;
export const DEFAULT_DAILY_CAP = 20;
export const SEND_HOUR_LONDON = 10;

const OPT_OUT_LINE = /stop to opt out|reply\s+stop|text\s+stop|send\s+stop|\bopt[\s-]*out\b/i;

export function londonDateTime(input) {
  if (input instanceof Date) return DateTime.fromJSDate(input, { zone: LONDON });
  return DateTime.fromISO(String(input), { zone: LONDON });
}

export function londonDate(input) {
  const dt = londonDateTime(input);
  if (!dt.isValid) return null;
  return dt.toISODate();
}

export function londonHour(input) {
  const dt = londonDateTime(input);
  if (!dt.isValid) return null;
  return dt.hour;
}

/** Whole London calendar days from startDate to endDate. DST days still count as one. */
export function daysBetween(startDate, endDate) {
  const a = DateTime.fromISO(String(startDate), { zone: LONDON }).startOf('day');
  const b = DateTime.fromISO(String(endDate), { zone: LONDON }).startOf('day');
  if (!a.isValid || !b.isValid) return null;
  const sign = b >= a ? 1 : -1;
  let cursor = sign > 0 ? a : b;
  const end = sign > 0 ? b : a;
  let n = 0;
  while (cursor < end) {
    cursor = cursor.plus({ days: 1 });
    n += 1;
  }
  return sign * n;
}

export function addLondonDays(isoDate, days) {
  const dt = DateTime.fromISO(String(isoDate), { zone: LONDON }).startOf('day');
  if (!dt.isValid) return null;
  return dt.plus({ days }).toISODate();
}

export function stepCopy(day, copy = outreachCopy) {
  const row = (copy.steps || []).find((step) => step.day === day);
  if (!row) {
    const err = new Error(`Missing outreach copy for day ${day}.`);
    err.code = 'NO_COPY';
    throw err;
  }
  return row;
}

export function fillTemplate(template, vars) {
  return String(template ?? '')
    .replaceAll('{business}', vars.business ?? '')
    .replaceAll('{link}', vars.link ?? '');
}

export function hasEmDash(text) {
  return String(text ?? '').includes('\u2014');
}

export function hasOptOutLine(text) {
  return OPT_OUT_LINE.test(String(text ?? ''));
}

export function copyProblems(text) {
  const problems = [];
  if (hasEmDash(text)) problems.push('em-dash');
  if (hasOptOutLine(text)) problems.push('opt-out-line');
  return problems;
}

export function checkSmsBody(body) {
  const text = String(body ?? '').replace(/[ \t]+/g, ' ').trim();
  const problems = copyProblems(text);
  if (problems.length) return { ok: false, body: text, reason: problems[0] };
  const septets = gsmSeptetLength(text);
  if (septets == null) return { ok: false, body: text, reason: 'not-gsm7' };
  if (septets > SMS_SEPTET_LIMIT) {
    return { ok: false, body: text, reason: 'too-long', septets };
  }
  return { ok: true, body: text, septets };
}

export function renderSms(day, vars, copy = outreachCopy) {
  return checkSmsBody(fillTemplate(stepCopy(day, copy).sms, vars));
}

export function renderEmail(day, vars, copy = outreachCopy) {
  const row = stepCopy(day, copy);
  const subject = fillTemplate(row.emailSubject, vars).trim();
  const text = fillTemplate(row.emailText, vars).trim();
  const problems = [...copyProblems(subject), ...copyProblems(text)];
  if (!subject || !text) problems.push('empty');
  if (problems.length) return { ok: false, subject, text, reason: problems[0] };
  return { ok: true, subject, text };
}

export function renderWhatsapp(day, vars, copy = outreachCopy) {
  const row = stepCopy(day, copy);
  const variables = {};
  const problems = [];
  for (const [key, template] of Object.entries(row.whatsappVariables || {})) {
    const value = fillTemplate(template, vars).trim();
    variables[key] = value;
    problems.push(...copyProblems(value));
    if (!value) problems.push('empty');
  }
  if (!Object.keys(variables).length) problems.push('empty');
  if (problems.length) {
    return {
      ok: false,
      variables,
      reason: problems[0],
      template: row.whatsappTemplate,
      contentSidEnv: row.whatsappContentSidEnv,
    };
  }
  return {
    ok: true,
    variables,
    template: row.whatsappTemplate,
    contentSidEnv: row.whatsappContentSidEnv,
  };
}

export function sentDays(lead) {
  const touches = (lead && lead.sequence && lead.sequence.touches) || [];
  return touches
    .map((touch) => touch && touch.day)
    .filter((day) => STEP_DAYS.includes(day));
}

/**
 * Earliest unsent step whose London due date is today or earlier.
 * A late run does not skip Day 0 to jump to Day 3 or Day 10.
 */
export function dueStep(startedAt, now, alreadySent = []) {
  const start = londonDate(startedAt);
  const today = londonDate(now);
  if (!start || !today) return null;
  const age = daysBetween(start, today);
  if (age == null || age < 0) return null;
  const sent = new Set(alreadySent);
  for (const day of STEP_DAYS) {
    if (age >= day && !sent.has(day)) {
      return { day, dueOn: addLondonDays(start, day), age };
    }
  }
  return null;
}

export function nextDueOn(startedAt, alreadySent = []) {
  const start = londonDate(startedAt);
  if (!start) return null;
  const sent = new Set(alreadySent);
  for (const day of STEP_DAYS) {
    if (!sent.has(day)) return addLondonDays(start, day);
  }
  return null;
}

export function sequenceComplete(alreadySent = []) {
  const sent = new Set(alreadySent);
  return STEP_DAYS.every((day) => sent.has(day));
}

export function parseDailyCap(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_DAILY_CAP;
  return n;
}

export function canSend({ sentToday, whatsappSentToday, cap, channel, whatsappLimit = WHATSAPP_DAILY_LIMIT }) {
  if (sentToday >= cap) return { ok: false, reason: 'daily-cap' };
  if (channel === 'whatsapp' && whatsappSentToday >= whatsappLimit) {
    return { ok: false, reason: 'whatsapp-cap' };
  }
  return { ok: true };
}

export function countSendsOn(leads, today) {
  let sentToday = 0;
  let whatsappSentToday = 0;
  for (const lead of leads || []) {
    const touches = (lead.sequence && lead.sequence.touches) || [];
    for (const touch of touches) {
      if (!touch || !touch.at || londonDate(touch.at) !== today) continue;
      sentToday += 1;
      if ((touch.channel || lead.channel) === 'whatsapp') whatsappSentToday += 1;
    }
  }
  return { sentToday, whatsappSentToday };
}
