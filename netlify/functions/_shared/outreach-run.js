/**
 * Enrol a lead, list sequencer status, and send the one due step per lead.
 * Day 0 sends as soon as the lead is enrolled. Day 3 and Day 10 wait for 19:00
 * Europe/London. OUTREACH_SEND_LIVE=1 sends. Any other value logs the would-be
 * send and writes no touch. A reply does not stop the sequence. Purchase does.
 */
import { readEnv } from './billing-env.js';
import {
  findActiveSiteAccount,
  getLead,
  isSuppressed,
  listLeads,
  saveLead,
  stopLeadManually,
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
  const stopped = Boolean(
    lead.purchased
    || (lead.sequence && (lead.sequence.status === 'stopped' || lead.sequence.status === 'halted')),
  );
  const last = days.length ? days[days.length - 1] : null;
  return {
    phone: lead.phone,
    channel: lead.channel || null,
    businessName: lead.businessName || null,
    siteId: lead.siteId || null,
    step: last,
    nextDueOn: complete || stopped || !startedAt ? null : nextDueOn(startedAt, days),
    replied: lead.replied === true,
    optedOut: lead.optedOut === true,
    purchased: lead.purchased === true,
    suppressed: Boolean(suppressed || lead.suppressed),
    complete: Boolean(complete),
    stopped,
    stopReason: (lead.sequence && lead.sequence.haltReason) || null,
    status: (lead.sequence && lead.sequence.status) || 'idle',
    smsFlag: lead.smsFlag || null,
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
      if (sms.ok) continue;
      if (sms.reason === 'too-long' || sms.reason === 'not-gsm7') continue;
      return { day, channel, reason: sms.reason, septets: sms.septets };
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
  const sequence = existing && existing.sequence;
  const enrolled = Boolean(
    sequence && (
      sequence.status === 'active'
      || sequence.status === 'complete'
      || sequence.status === 'stopped'
      || sequence.startedAt
      || (sequence.touches || []).length
    ),
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
  let alreadyBought = null;
  try {
    alreadyBought = await findActiveSiteAccount(siteId, deps.accounts);
  } catch (err) {
    logLine(deps, 'error', `[outreach] purchase lookup failed ${err.message}`);
  }
  const purchased = Boolean(alreadyBought);
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
      purchased,
      purchasedAt: purchased ? at : null,
      purchasePlan: alreadyBought && alreadyBought.plan ? alreadyBought.plan : null,
      purchaseSource: purchased ? 'billing' : null,
      sequence: {
        status: purchased ? 'stopped' : 'active',
        startedAt: at,
        day0At: at,
        nextTouchOn: purchased ? null : due,
        touches: [],
        haltReason: purchased ? 'purchased' : null,
        haltedAt: purchased ? at : null,
      },
    },
    store,
  );
  let day0 = null;
  if (!purchased && lead.sequence.status === 'active') {
    day0 = await sendStepForLead(lead, 0, { ...deps, env, store, now: now instanceof Date ? now : new Date(now) });
  }
  const stored = (await getLead(phone, store)) || lead;
  return {
    status: 200,
    body: {
      ok: true,
      phone: stored.phone,
      channel,
      day0At: at,
      nextDueOn: stored.sequence.nextTouchOn,
      status: stored.sequence.status,
      purchased: stored.purchased === true,
      day0,
    },
  };
}

export async function stopOutreachLead(body, deps = {}) {
  const store = deps.store;
  const now = deps.now ? deps.now() : new Date();
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const siteId = field(body, 'site_id', 'siteId');
  const phone = toE164(field(body, 'phone'));
  if (!phone && !siteId) return { status: 400, body: { error: 'missing_phone_or_site' } };
  if (siteId) {
    const leads = (await listLeads(store)).filter((lead) => String(lead.siteId || '') === siteId);
    if (!leads.length && !phone) return { status: 404, body: { error: 'not_found' } };
    const stopped = [];
    for (const lead of leads) {
      const next = await stopLeadManually(lead.phone, { at }, store);
      if (next) stopped.push(next.phone);
    }
    if (phone) {
      const next = await stopLeadManually(phone, { at }, store);
      if (next && !stopped.includes(next.phone)) stopped.push(next.phone);
    }
    if (!stopped.length) return { status: 404, body: { error: 'not_found' } };
    return { status: 200, body: { ok: true, stopped, reason: 'manual' } };
  }
  const next = await stopLeadManually(phone, { at }, store);
  if (!next) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { ok: true, stopped: [next.phone], reason: 'manual' } };
}

function contentSid(env, rendered) {
  const fromEnv = String(readEnv(rendered.contentSidEnv, env) || '').trim();
  if (fromEnv) return fromEnv;
  return String(rendered.contentSid || '').trim();
}

function smsDetail(delivered) {
  if (!delivered || !delivered.variant) return '';
  const segments = delivered.segments;
  const label = segments === 1 ? 'segment' : 'segments';
  return ` variant ${delivered.variant} ${delivered.septets} septets ${segments} ${label}`;
}

async function deliver({ channel, lead, day, env, deps }) {
  const vars = { business: lead.businessName || '', link: lead.previewUrl || '' };
  if (channel === 'sms') {
    const sms = renderSms(day, vars);
    if (!sms.ok) {
      const at = deps.now instanceof Date ? deps.now.toISOString() : new Date(deps.now || Date.now()).toISOString();
      logLine(
        deps,
        'error',
        `[outreach] skip sms day ${day} ${lead.phone} ${sms.reason}. Flagged. Not sent.`,
      );
      try {
        await saveLead(lead.phone, {
          smsFlag: {
            day,
            reason: sms.reason,
            at,
            septets: sms.septets ?? null,
          },
        }, deps.store);
      } catch (err) {
        logLine(deps, 'error', `[outreach] could not flag ${lead.phone} ${err.message}`);
      }
      return { ok: false, skipped: true, reason: sms.reason, preview: sms.body, flagged: true };
    }
    if (!outreachLive(env)) {
      return {
        ok: true,
        dryRun: true,
        preview: sms.body,
        variant: sms.variant,
        septets: sms.septets,
        segments: sms.segments,
      };
    }
    const sent = await sendOutreachSms({
      to: lead.phone,
      body: sms.body,
      maxSeptets: sms.maxSeptets,
      env,
      fetchImpl: deps.fetchImpl,
    });
    return {
      ...sent,
      preview: sms.body,
      variant: sms.variant,
      septets: sms.septets,
      segments: sms.segments,
    };
  }
  if (channel === 'whatsapp') {
    const wa = renderWhatsapp(day, vars);
    if (!wa.ok) {
      logLine(deps, 'error', `[outreach] skip whatsapp day ${day} ${lead.phone} ${wa.reason}`);
      return { ok: false, skipped: true, reason: wa.reason };
    }
    const sid = contentSid(env, wa);
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

function sendFailureLine(phone, day, err) {
  const blocked = err.twilioCode === 21610
    || /unsubscribed|opted out|blacklist|not a valid mobile/i.test(String(err.message || ''));
  const note = blocked
    ? 'Twilio may have blocked this number after STOP. Continuing.'
    : 'Continuing.';
  return `[outreach] send failed ${phone} day ${day} ${err.twilioCode || err.code || ''} ${err.message}. ${note}`;
}

async function sendStepForLead(lead, day, deps) {
  const env = deps.env || process.env;
  const store = deps.store;
  const now = deps.now instanceof Date ? deps.now : new Date(deps.now || Date.now());
  const phone = lead.phone;
  const fresh = await getLead(phone, store);
  if (!fresh || fresh.purchased === true || (fresh.sequence && fresh.sequence.status === 'stopped')) {
    return { phone, day, skipped: fresh && fresh.purchased ? 'purchased' : 'stopped' };
  }
  if (sentDays(fresh).includes(day)) return { phone, day, skipped: 'already-sent' };
  let delivered;
  try {
    delivered = await deliver({ channel: fresh.channel, lead: fresh, day, env, deps });
  } catch (err) {
    logLine(deps, 'error', sendFailureLine(phone, day, err));
    return { phone, day, error: err.code || 'send-failed' };
  }
  if (!delivered || delivered.ok === false) {
    return { phone, day, skipped: delivered && delivered.reason };
  }
  if (!outreachLive(env) || delivered.dryRun) {
    const preview = typeof delivered.preview === 'string' ? delivered.preview : JSON.stringify(delivered.preview);
    logLine(
      deps,
      'log',
      `[outreach] dry run would send day ${day} ${fresh.channel} ${phone}${smsDetail(delivered)} ${preview}`,
    );
    return {
      phone,
      day,
      dryRun: true,
      variant: delivered.variant || null,
      septets: delivered.septets ?? null,
      segments: delivered.segments ?? null,
    };
  }
  const again = await getLead(phone, store);
  if (!again || again.purchased === true || (again.sequence && again.sequence.status === 'stopped')) {
    return { phone, day, skipped: 'stopped' };
  }
  if (sentDays(again).includes(day)) return { phone, day, skipped: 'already-sent' };
  const touch = {
    day,
    channel: fresh.channel,
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
  logLine(
    deps,
    'log',
    `[outreach] sent day ${day} ${fresh.channel} ${phone}${smsDetail(delivered)} ${touch.messageSid || ''} ${touch.status}`,
  );
  return {
    phone,
    day,
    id: touch.messageSid,
    status: touch.status,
    complete: finished,
    variant: delivered.variant || null,
    septets: delivered.septets ?? null,
    segments: delivered.segments ?? null,
  };
}

export async function runOutreachDay(deps = {}) {
  const env = deps.env || process.env;
  const store = deps.store;
  const now = deps.now ? (deps.now instanceof Date ? deps.now : new Date(deps.now)) : new Date();
  const live = outreachLive(env);
  const cap = outreachCap(env);
  const waLimit = Number.isInteger(deps.whatsappDailyLimit) ? deps.whatsappDailyLimit : WHATSAPP_DAILY_LIMIT;
  const onlyDays = Array.isArray(deps.onlyDays) ? deps.onlyDays : [0, 3, 10];
  const today = londonDate(now);
  const leads = (await listLeads(store)).sort((a, b) => String(a.phone).localeCompare(String(b.phone)));
  const counts = countSendsOn(leads, today);
  let sentToday = counts.sentToday;
  let whatsappSentToday = counts.whatsappSentToday;
  const results = [];

  for (const lead of leads) {
    if (deps.phone && lead.phone !== deps.phone) continue;
    const phone = lead.phone;
    const status = lead.sequence && lead.sequence.status;
    if (status !== 'active') continue;
    if (lead.purchased === true) continue;
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
    if (!due || !onlyDays.includes(due.day)) continue;

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

    const outcome = await sendStepForLead(lead, due.day, { ...deps, env, store, now });
    results.push(outcome);
    if (outcome && (outcome.id || outcome.dryRun)) {
      sentToday += 1;
      if (channel === 'whatsapp') whatsappSentToday += 1;
    }
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
