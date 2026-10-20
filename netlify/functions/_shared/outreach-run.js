/**
 * Enrol a lead, list sequencer status, and send the one due step per lead.
 * OUTREACH_SEND_LIVE=1 sends. Any other value logs the would-be send and
 * writes no touch. A reply or a suppression row stops the lead before send.
 */
import { readEnv } from './billing-env.js';
import {
  getLead,
  hasReplied,
  isSuppressed,
  listLeads,
  saveLead,
  toE164,
} from './inbound-store.js';
import {
  canSend,
  countSendsOn,
  dueStep,
  londonDate,
  nextDueOn,
  parseDailyCap,
  renderEmail,
  renderSms,
  renderWhatsapp,
  sentDays,
  sequenceComplete,
  WHATSAPP_DAILY_LIMIT,
} from '../../../shared/outreach-sequence.js';
import { sendOutreachEmail, sendOutreachSms, sendOutreachWhatsapp } from './outreach-send.js';

const CHANNELS = new Set(['sms', 'whatsapp', 'email']);

function logLine(deps, level, message) {
  const fn = level === 'error' ? console.error : console.log;
  fn(message);
  if (deps && typeof deps.log === 'function') deps.log(message);
}

export function outreachLive(env) {
  return readEnv('OUTREACH_SEND_LIVE', env) === '1';
}

export function outreachCap(env) {
  return parseDailyCap(readEnv('OUTREACH_DAILY_CAP', env));
}

export function leadView(lead, suppressed) {
  const days = sentDays(lead);
  const startedAt = lead.sequence && (lead.sequence.day0At || lead.sequence.startedAt);
  const complete = lead.sequence && lead.sequence.status === 'complete';
  const halted = lead.sequence && lead.sequence.status === 'halted';
  const last = days.length ? days[days.length - 1] : null;
  return {
    phone: lead.phone,
    channel: lead.channel || null,
    businessName: lead.businessName || null,
    step: last,
    nextDueOn: complete || halted || !startedAt ? null : nextDueOn(startedAt, days),
    replied: lead.replied === true,
    suppressed: Boolean(suppressed || lead.suppressed),
    complete: Boolean(complete),
    status: (lead.sequence && lead.sequence.status) || 'idle',
  };
}

function field(body, ...keys) {
  for (const key of keys) {
    if (body && body[key] != null && String(body[key]).trim()) return String(body[key]).trim();
  }
  return '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function copyError(channel, vars) {
  if (channel === 'sms') {
    for (const day of [0, 3, 10]) {
      const sms = renderSms(day, vars);
      if (!sms.ok) return { day, channel, reason: sms.reason, septets: sms.septets };
    }
    return null;
  }
  if (channel === 'email') {
    for (const day of [0, 3, 10]) {
      const email = renderEmail(day, vars);
      if (!email.ok) return { day, channel, reason: email.reason };
    }
    return null;
  }
  for (const day of [0, 3, 10]) {
    const wa = renderWhatsapp(day, vars);
    if (!wa.ok) return { day, channel, reason: wa.reason };
  }
  return null;
}

export async function enrolLead(body, deps = {}) {
  const env = deps.env || process.env;
  const store = deps.store;
  const now = deps.now ? deps.now() : new Date();
  const phone = toE164(field(body, 'phone'));
  const channel = field(body, 'channel').toLowerCase();
  const email = field(body, 'email');
  const businessName = field(body, 'businessName', 'business_name', 'business');
  const trade = field(body, 'trade');
  const town = field(body, 'town');
  const previewUrl = field(body, 'previewUrl', 'preview_url');
  const placeId = field(body, 'place_id', 'placeId');
  const siteId = field(body, 'site_id', 'siteId');

  if (!phone) return { status: 400, body: { error: 'bad_phone' } };
  if (!CHANNELS.has(channel)) return { status: 400, body: { error: 'bad_channel' } };
  if (!previewUrl) return { status: 400, body: { error: 'missing_preview_url' } };
  let preview;
  try {
    preview = new URL(previewUrl);
  } catch {
    preview = null;
  }
  if (!preview || (preview.protocol !== 'https:' && preview.protocol !== 'http:')) {
    return { status: 400, body: { error: 'bad_preview_url' } };
  }
  if (!businessName) return { status: 400, body: { error: 'missing_business' } };
  if (!trade) return { status: 400, body: { error: 'missing_trade' } };
  if (!town) return { status: 400, body: { error: 'missing_town' } };
  if (!placeId) return { status: 400, body: { error: 'missing_place_id' } };
  if (!siteId) return { status: 400, body: { error: 'missing_site_id' } };
  if (channel === 'email' && !email) return { status: 400, body: { error: 'missing_email' } };
  if (email && !validEmail(email)) return { status: 400, body: { error: 'bad_email' } };

  const existing = await getLead(phone, store);
  if (await isSuppressed(phone, store) || (existing && existing.suppressed)) {
    return { status: 409, body: { error: 'suppressed' } };
  }
  if (await hasReplied(phone, store) || (existing && existing.replied)) {
    return { status: 409, body: { error: 'replied' } };
  }
  const sequence = existing && existing.sequence;
  const enrolled = Boolean(
    sequence && (sequence.status === 'active' || sequence.status === 'complete' || sequence.startedAt || (sequence.touches || []).length),
  );
  if (enrolled) return { status: 409, body: { error: 'already_enrolled' } };

  const vars = { business: businessName, link: previewUrl };
  const blocked = copyError(channel, vars);
  if (blocked) {
    logLine(
      deps,
      'error',
      `[outreach] refuse enrol ${phone} day ${blocked.day} ${blocked.channel} ${blocked.reason}`,
    );
    return { status: 400, body: { error: blocked.reason, day: blocked.day } };
  }

  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const due = londonDate(at);
  const lead = await saveLead(
    phone,
    {
      businessName,
      previewUrl,
      placeId,
      email: email || null,
      channel,
      trade,
      town,
      siteId,
      lastChannel: channel,
      sequence: {
        status: 'active',
        startedAt: at,
        day0At: at,
        nextTouchOn: due,
        touches: [],
        haltReason: null,
        haltedAt: null,
      },
    },
    store,
  );
  return {
    status: 200,
    body: {
      ok: true,
      phone: lead.phone,
      channel,
      day0At: at,
      nextDueOn: due,
      status: lead.sequence.status,
    },
  };
}

async function stopLead(phone, store, deps, reason) {
  await saveLead(phone, {}, store);
  logLine(deps, 'log', `[outreach] stop ${phone} ${reason}`);
}

function contentSid(env, name) {
  return String(readEnv(name, env) || '').trim();
}

async function deliver({ channel, lead, day, env, deps }) {
  const vars = { business: lead.businessName || '', link: lead.previewUrl || '' };
  if (channel === 'sms') {
    const sms = renderSms(day, vars);
    if (!sms.ok) {
      logLine(deps, 'error', `[outreach] skip sms day ${day} ${lead.phone} ${sms.reason}`);
      return { ok: false, skipped: true, reason: sms.reason, preview: sms.body };
    }
    if (!outreachLive(env)) {
      return { ok: true, dryRun: true, preview: sms.body };
    }
    const sent = await sendOutreachSms({
      to: lead.phone,
      body: sms.body,
      env,
      fetchImpl: deps.fetchImpl,
    });
    return { ...sent, preview: sms.body };
  }
  if (channel === 'whatsapp') {
    const wa = renderWhatsapp(day, vars);
    if (!wa.ok) {
      logLine(deps, 'error', `[outreach] skip whatsapp day ${day} ${lead.phone} ${wa.reason}`);
      return { ok: false, skipped: true, reason: wa.reason };
    }
    const sid = contentSid(env, wa.contentSidEnv);
    if (!sid) {
      logLine(
        deps,
        'error',
        `[outreach] skip whatsapp day ${day} ${lead.phone} ${wa.contentSidEnv} is not set (template ${wa.template})`,
      );
      return { ok: false, skipped: true, reason: 'no-content-sid', template: wa.template };
    }
    if (!outreachLive(env)) {
      return { ok: true, dryRun: true, preview: wa.variables, contentSid: sid, template: wa.template };
    }
    const sent = await sendOutreachWhatsapp({
      to: lead.phone,
      contentSid: sid,
      variables: wa.variables,
      env,
      fetchImpl: deps.fetchImpl,
    });
    return { ...sent, template: wa.template };
  }
  const email = renderEmail(day, vars);
  if (!email.ok) {
    logLine(deps, 'error', `[outreach] skip email day ${day} ${lead.phone} ${email.reason}`);
    return { ok: false, skipped: true, reason: email.reason };
  }
  if (!lead.email) {
    logLine(deps, 'error', `[outreach] skip email day ${day} ${lead.phone} missing email`);
    return { ok: false, skipped: true, reason: 'missing-email' };
  }
  if (!outreachLive(env)) {
    return { ok: true, dryRun: true, preview: { to: lead.email, subject: email.subject, text: email.text } };
  }
  const sent = await sendOutreachEmail({
    to: lead.email,
    subject: email.subject,
    text: email.text,
    env,
    sendMailImpl: deps.sendMail,
  });
  if (!sent.ok) {
    logLine(deps, 'error', `[outreach] skip email day ${day} ${lead.phone} ${sent.reason}`);
  }
  return sent;
}

export async function runOutreachDay(deps = {}) {
  const env = deps.env || process.env;
  const store = deps.store;
  const now = deps.now ? (deps.now instanceof Date ? deps.now : new Date(deps.now)) : new Date();
  const live = outreachLive(env);
  const cap = outreachCap(env);
  const waLimit = Number.isInteger(deps.whatsappDailyLimit) ? deps.whatsappDailyLimit : WHATSAPP_DAILY_LIMIT;
  const today = londonDate(now);
  const leads = (await listLeads(store)).sort((a, b) => String(a.phone).localeCompare(String(b.phone)));
  const counts = countSendsOn(leads, today);
  let sentToday = counts.sentToday;
  let whatsappSentToday = counts.whatsappSentToday;
  const results = [];

  for (const lead of leads) {
    const phone = lead.phone;
    const status = lead.sequence && lead.sequence.status;
    if (status !== 'active') continue;
    if (await hasReplied(phone, store) || await isSuppressed(phone, store)) {
      const reason = (await hasReplied(phone, store)) ? 'replied' : 'suppressed';
      await stopLead(phone, store, deps, reason);
      results.push({ phone, stopped: reason });
      continue;
    }
    const startedAt = lead.sequence.day0At || lead.sequence.startedAt;
    const days = sentDays(lead);
    if (sequenceComplete(days)) {
      await saveLead(phone, {
        sequence: { ...lead.sequence, status: 'complete', nextTouchOn: null },
      }, store);
      results.push({ phone, complete: true });
      continue;
    }
    const due = dueStep(startedAt, now, days);
    if (!due) continue;

    const channel = lead.channel;
    const quota = canSend({
      sentToday,
      whatsappSentToday,
      cap,
      channel,
      whatsappLimit: waLimit,
    });
    if (!quota.ok && quota.reason === 'daily-cap') {
      logLine(deps, 'log', `[outreach] daily cap ${cap} reached. Remaining leads wait.`);
      results.push({ phone, skipped: 'daily-cap' });
      break;
    }
    if (!quota.ok && quota.reason === 'whatsapp-cap') {
      logLine(deps, 'log', `[outreach] WhatsApp daily limit ${waLimit} reached. Skip ${phone}.`);
      results.push({ phone, skipped: 'whatsapp-cap' });
      continue;
    }

    const fresh = await getLead(phone, store);
    if (!fresh || sentDays(fresh).includes(due.day)) continue;
    if (await hasReplied(phone, store) || await isSuppressed(phone, store)) {
      const reason = (await hasReplied(phone, store)) ? 'replied' : 'suppressed';
      await stopLead(phone, store, deps, reason);
      results.push({ phone, stopped: reason });
      continue;
    }

    let delivered;
    try {
      delivered = await deliver({ channel, lead: fresh, day: due.day, env, deps });
    } catch (err) {
      logLine(deps, 'error', `[outreach] send failed ${phone} day ${due.day} ${err.code || ''} ${err.message}`);
      results.push({ phone, day: due.day, error: err.code || 'send-failed' });
      continue;
    }
    if (!delivered || delivered.ok === false) {
      results.push({ phone, day: due.day, skipped: delivered && delivered.reason });
      continue;
    }
    if (!live || delivered.dryRun) {
      const preview = typeof delivered.preview === 'string' ? delivered.preview : JSON.stringify(delivered.preview);
      logLine(deps, 'log', `[outreach] dry run would send day ${due.day} ${channel} ${phone} ${preview}`);
      results.push({ phone, day: due.day, dryRun: true });
      sentToday += 1;
      if (channel === 'whatsapp') whatsappSentToday += 1;
      continue;
    }

    const again = await getLead(phone, store);
    if (!again || sentDays(again).includes(due.day)) continue;
    const touch = {
      day: due.day,
      channel,
      at: now.toISOString(),
      messageSid: delivered.id || null,
      status: delivered.status || 'sent',
    };
    const touches = [...((again.sequence && again.sequence.touches) || []), touch];
    const finished = sequenceComplete(sentDays({ sequence: { touches } }));
    await saveLead(phone, {
      sequence: {
        ...again.sequence,
        status: finished ? 'complete' : 'active',
        touches,
        nextTouchOn: finished ? null : nextDueOn(again.sequence.day0At || again.sequence.startedAt, sentDays({ sequence: { touches } })),
      },
    }, store);
    sentToday += 1;
    if (channel === 'whatsapp') whatsappSentToday += 1;
    logLine(deps, 'log', `[outreach] sent day ${due.day} ${channel} ${phone} ${touch.messageSid || ''} ${touch.status}`);
    results.push({ phone, day: due.day, id: touch.messageSid, status: touch.status, complete: finished });
  }

  return { ok: true, dryRun: !live, today, cap, results };
}

export async function listOutreachStatus(deps = {}) {
  const store = deps.store;
  const leads = await listLeads(store);
  const rows = [];
  for (const lead of leads) {
    rows.push(leadView(lead, await isSuppressed(lead.phone, store)));
  }
  rows.sort((a, b) => String(a.phone).localeCompare(String(b.phone)));
  return { leads: rows };
}
