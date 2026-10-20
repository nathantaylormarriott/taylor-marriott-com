/**
 * Day 0 / Day 3 / Day 10 timing and copy checks.
 * Calendar days are Europe/London, so GMT and BST do not shift the due date.
 * dueStep uses the London calendar date. Day 0 can send at any hour.
 * The evening job sends Day 3 and Day 10 only when the London hour is 19.
 * Day 0 SMS walks an ordered fallback. Variants a to c must fit in 159 GSM-7
 * septets. Variants d and e may use two concatenated segments, 306 septets.
 * Day 3 and Day 10 stay at 159. Nothing here appends an opt-out line.
 */
import { DateTime } from 'luxon';
import outreachCopy from '../config/outreach-copy.json' with { type: 'json' };
import { gsmSeptetLength, SMS_SEPTET_LIMIT } from './sms-gsm.js';

export const LONDON = 'Europe/London';
export const STEP_DAYS = [0, 3, 10];
export const WHATSAPP_DAILY_LIMIT = 250;
export const DEFAULT_DAILY_CAP = 20;
export const SEND_HOUR_LONDON = 19;
export const SMS_TWO_SEGMENT_LIMIT = 306;

const PUNCT_FOLDS = [
  ['\u2014', '-'],
  ['\u2013', '-'],
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201C', '"'],
  ['\u201D', '"'],
  ['\u00A0', ' '],
  ['\u2026', '...'],
];

const LETTER_FOLDS = {
  À: 'A', Á: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A',
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
  È: 'E', É: 'E', Ê: 'E', Ë: 'E',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  Ì: 'I', Í: 'I', Î: 'I', Ï: 'I',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  Ò: 'O', Ó: 'O', Ô: 'O', Õ: 'O', Ö: 'O',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o',
  Ù: 'U', Ú: 'U', Û: 'U', Ü: 'U',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  Ñ: 'N', ñ: 'n',
  Ç: 'C', ç: 'c',
  ß: 'ss',
  Æ: 'AE', æ: 'ae',
  Ø: 'O', ø: 'o',
  Ý: 'Y', ý: 'y', ÿ: 'y',
};

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

/** 159 or fewer is one segment. 160 to 306 is two. Over 306 is not sent. */
export function smsSegmentCount(septets) {
  if (septets == null) return null;
  if (septets <= SMS_SEPTET_LIMIT) return 1;
  if (septets <= SMS_TWO_SEGMENT_LIMIT) return 2;
  return null;
}

/**
 * Fold punctuation and Latin letters to close ASCII. Characters with no
 * equivalent stay in the string so the GSM-7 check fails and the next SMS
 * variant can be tried. This does not drop characters.
 */
export function foldToAscii(value) {
  let text = String(value ?? '');
  for (const [from, to] of PUNCT_FOLDS) text = text.split(from).join(to);
  let out = '';
  for (const ch of text) out += Object.prototype.hasOwnProperty.call(LETTER_FOLDS, ch) ? LETTER_FOLDS[ch] : ch;
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** SMS only. Email and WhatsApp keep the full preview URL. */
export function smsPreviewLink(url) {
  return String(url ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function checkSmsBody(body, maxSeptets = SMS_SEPTET_LIMIT) {
  const text = String(body ?? '').replace(/[ \t]+/g, ' ').trim();
  const problems = copyProblems(text);
  if (problems.length) return { ok: false, body: text, reason: problems[0], septets: null, segments: null };
  const septets = gsmSeptetLength(text);
  if (septets == null) return { ok: false, body: text, reason: 'not-gsm7', septets: null, segments: null };
  if (septets > maxSeptets) {
    return { ok: false, body: text, reason: 'too-long', septets, segments: null };
  }
  return { ok: true, body: text, septets, segments: smsSegmentCount(septets) };
}

function renderSingleSms(template, vars, maxSeptets) {
  const checked = checkSmsBody(fillTemplate(template, vars), maxSeptets);
  return { ...checked, variant: null, maxSeptets };
}

function renderDay0Sms(row, vars) {
  const business = foldToAscii(vars.business);
  const link = foldToAscii(smsPreviewLink(vars.link));
  const variants = row.smsVariants || [];
  let last = { ok: false, body: '', reason: 'too-long', septets: null, segments: null };
  for (const variant of variants) {
    const name = variant.business != null ? foldToAscii(variant.business) : business;
    const checked = checkSmsBody(
      fillTemplate(variant.text, { business: name, link }),
      variant.maxSeptets || SMS_SEPTET_LIMIT,
    );
    if (checked.ok) {
      return {
        ...checked,
        variant: variant.id,
        maxSeptets: variant.maxSeptets || SMS_SEPTET_LIMIT,
      };
    }
    last = checked;
  }
  return { ...last, variant: null, maxSeptets: null };
}

export function renderSms(day, vars, copy = outreachCopy) {
  const row = stepCopy(day, copy);
  if (day === 0 && Array.isArray(row.smsVariants) && row.smsVariants.length) {
    return renderDay0Sms(row, vars);
  }
  return renderSingleSms(row.sms, vars, SMS_SEPTET_LIMIT);
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
      contentSid: row.whatsappContentSid || '',
      contentSidEnv: row.whatsappContentSidEnv,
    };
  }
  return {
    ok: true,
    variables,
    template: row.whatsappTemplate,
    contentSid: row.whatsappContentSid || '',
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
