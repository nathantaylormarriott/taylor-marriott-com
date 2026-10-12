/**
 * Pure billing decisions: dunning, reminders, pause, resume, reconcile.
 * No Stripe, Netlify, or network calls.
 */

export const MAX_DUNNING_ATTEMPTS = 10;
export const REMINDER_DAYS = Object.freeze([30, 14, 7]);

export function londonDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function daysUntil(target, now) {
  const a = new Date(`${londonDateKey(now)}T12:00:00Z`).getTime();
  const b = new Date(`${londonDateKey(target)}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

export function emptyDunning(invoiceId) {
  return {
    invoiceId,
    attemptCount: 0,
    lastAttemptOn: null,
    status: 'open',
    notifications: [],
  };
}

/**
 * One failed attempt. Email and SMS go out after every failure (all 10 days).
 * The 10th failure closes the invoice as uncollectible.
 */
export function recordFailedAttempt(record, { todayKey, hostedInvoiceUrl }) {
  const rec = record || emptyDunning('unknown');
  if (rec.status === 'paid' || rec.status === 'uncollectible') {
    return { record: rec, notified: false, closed: rec.status === 'uncollectible', skipped: 'closed' };
  }
  if (rec.lastAttemptOn === todayKey) {
    return { record: rec, notified: false, closed: false, skipped: 'already_attempted_today' };
  }
  if (rec.attemptCount >= MAX_DUNNING_ATTEMPTS) {
    return { record: { ...rec, status: 'uncollectible' }, notified: false, closed: true, skipped: 'max' };
  }
  const attempt = rec.attemptCount + 1;
  const closed = attempt >= MAX_DUNNING_ATTEMPTS;
  const note = {
    attempt,
    on: todayKey,
    channel: 'email_and_sms',
    hostedInvoiceUrl: hostedInvoiceUrl || null,
    delivered: false,
  };
  return {
    record: {
      ...rec,
      attemptCount: attempt,
      lastAttemptOn: todayKey,
      status: closed ? 'uncollectible' : 'retrying',
      notifications: [...(rec.notifications || []), note],
    },
    notified: true,
    email: true,
    sms: true,
    attempt,
    closed,
    skipped: null,
  };
}

export function recordPaid(record, { todayKey }) {
  const rec = record || emptyDunning('unknown');
  return {
    ...rec,
    status: 'paid',
    paidOn: todayKey,
  };
}

export function noticePending(record, todayKey) {
  if (!record || record.lastAttemptOn !== todayKey) return null;
  const note = [...(record.notifications || [])].reverse().find((row) => row.on === todayKey);
  if (!note || note.delivered === true) return null;
  return note;
}

export function markNoticeDelivered(record, todayKey) {
  const rec = record || emptyDunning('unknown');
  return {
    ...rec,
    notifications: (rec.notifications || []).map((row) => (row.on === todayKey ? { ...row, delivered: true } : row)),
  };
}

export function canAttemptToday(record, todayKey) {
  if (!record) return true;
  if (record.status === 'paid' || record.status === 'uncollectible') return false;
  if (record.attemptCount >= MAX_DUNNING_ATTEMPTS) return false;
  if (record.lastAttemptOn === todayKey) return false;
  return true;
}

/** Final Stripe subscription status. past_due and a single failure are not enough. */
export function isTerminalUnpaidStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'unpaid' || s === 'canceled' || s === 'cancelled';
}

export function dueReminderDays(renewalAt, now, alreadySent = []) {
  const left = daysUntil(renewalAt, now);
  const sent = new Set(alreadySent);
  return REMINDER_DAYS.filter((d) => left === d && !sent.has(d));
}

/**
 * What to do when a subscription is terminally unpaid.
 * Monthly: pause the site and keep the custom domain until a renewal is due.
 * One-off domain renewal: drop the custom domain and do not renew at the registrar.
 */
export function pausePlan({ plan, domainRenewalDue }) {
  if (plan === 'monthly' && domainRenewalDue) {
    return {
      pauseSite: true,
      keepCustomDomain: false,
      detachDomain: true,
      renewAtRegistrar: false,
      httpStatus: 503,
    };
  }
  if (plan === 'monthly') {
    return {
      pauseSite: true,
      keepCustomDomain: true,
      detachDomain: false,
      renewAtRegistrar: false,
      httpStatus: 503,
    };
  }
  return {
    pauseSite: false,
    keepCustomDomain: false,
    detachDomain: true,
    renewAtRegistrar: false,
    httpStatus: null,
  };
}

/**
 * Pay later. Re-attach a domain we still own. If it lapsed, re-register only when
 * it is available and live purchases are on. Otherwise stay on the preview hostname
 * and email Nathan.
 */
export function resumePlan({ domainOwned, domainAvailable, purchaseLive }) {
  if (domainOwned) {
    return { reattachDomain: true, reregister: false, emailNathan: false, stayOnPreview: false };
  }
  if (domainAvailable && purchaseLive) {
    return { reattachDomain: true, reregister: true, emailNathan: false, stayOnPreview: false };
  }
  return {
    reattachDomain: false,
    reregister: false,
    emailNathan: true,
    stayOnPreview: true,
    reason: domainAvailable ? 'purchase_not_live' : 'domain_unavailable',
  };
}

/**
 * Reconcile local pause state with Stripe's subscription status.
 * A missed webhook is fixed here. A single payment_failed event is not.
 */
export function reconcileDrift({ stripeStatus, localPaused, plan, domainRenewalDue }) {
  const terminal = isTerminalUnpaidStatus(stripeStatus);
  if (terminal && !localPaused) {
    return { action: 'pause', ...pausePlan({ plan, domainRenewalDue }) };
  }
  if (!terminal && stripeStatus === 'active' && localPaused) {
    return { action: 'resume' };
  }
  return { action: 'none' };
}

/** Monthly £39 invoices do not renew the domain every month. */
export function shouldRenewDomainOnPaidInvoice({ plan, billingReason, domainRenewsAt, now, lastRenewedFor }) {
  if (billingReason !== 'subscription_cycle') return false;
  if (plan !== 'monthly') return true;
  if (!domainRenewsAt) return false;
  if (new Date(domainRenewsAt).getTime() > new Date(now).getTime()) return false;
  if (lastRenewedFor && lastRenewedFor === domainRenewsAt) return false;
  return true;
}
