import {
  canAttemptToday,
  dueReminderDays,
  emptyDunning,
  isTerminalUnpaidStatus,
  londonDateKey,
  markNoticeDelivered,
  noticePending,
  pausePlan,
  reconcileDrift,
  recordFailedAttempt,
  recordPaid,
  resumePlan,
  shouldRenewDomainOnPaidInvoice,
} from '../../../shared/billing-lifecycle.js';
import {
  NATHAN_EMAIL,
  buildAlertMessage,
  buildDunningMessage,
  buildReminderMessage,
  deliverNotice,
} from './billing-notify.js';
import { smsDunning, smsPause, smsReminder, smsResume, smsWhen } from '../../../shared/sms-templates.js';
import { createShortLink } from './short-link.js';

const DRY_SMS_LINK = 'https://taylor-marriott.com/p/dryrun01';

/**
 * One billing day. Dry-run unless the caller sets dryRun false.
 * An invoice with no injected outcome is not marked failed during dry-run,
 * so a scheduled pass cannot invent dunning attempts.
 * Each invoice is independent so one failure does not stop the rest.
 */
export async function runBillingDay(ctx) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const todayKey = londonDateKey(now);
  const log = [];
  const dryRun = ctx.dryRun !== false;

  const notify = async (notice) =>
    deliverNotice(
      notice,
      { dryRun: dryRun || ctx.notifyDryRun === true, sendEmail: ctx.sendEmail, sendSms: ctx.sendSms },
      ctx.env,
    );

  const alert = async (kind, siteName, detail) => {
    const text = buildAlertMessage({ kind, siteName, detail });
    const notice = await notify({ email: NATHAN_EMAIL, subject: `Billing ${kind}`, text, sms: null });
    log.push({ type: 'alert', kind, siteName: siteName || null, notice, dryRun });
    return notice;
  };

  const persist = async (invoiceId, record) => {
    if (ctx.persistDunning) await ctx.persistDunning(invoiceId, record);
  };

  const payLink = async (url) => {
    const target = typeof url === 'string' && url.startsWith('https://') ? url : 'https://billing.stripe.com';
    if (ctx.shorten) return ctx.shorten(target);
    if (dryRun) return DRY_SMS_LINK;
    return createShortLink(target);
  };

  const clientSms = async (source, sms) => {
    if (!source.phone || !sms) return null;
    return notify({
      email: null,
      phone: source.phone,
      subject: 'Taylor-Marriott',
      text: sms,
      sms,
    });
  };

  for (const open of ctx.openInvoices || []) {
    try {
      const current = open.dunning || emptyDunning(open.invoiceId);
      if (!canAttemptToday(current, todayKey)) {
        const pending = noticePending(current, todayKey);
        if (pending) {
          const hosted = pending.hostedInvoiceUrl || open.hostedInvoiceUrl || 'https://billing.stripe.com';
          const link = await payLink(hosted);
          const text = buildDunningMessage({
            hostedInvoiceUrl: hosted,
            attempt: pending.attempt,
            domain: open.domain,
          });
          const sms = smsDunning({
            business: open.businessName,
            domain: open.domain,
            attempt: pending.attempt,
            link,
          });
          const notice = await notify({
            email: open.email,
            phone: open.phone,
            subject: `Payment failed (${pending.attempt} of 10)`,
            text,
            sms,
          });
          const dunning = markNoticeDelivered(current, todayKey);
          await persist(open.invoiceId, dunning);
          log.push({ type: 'notice_retry', invoiceId: open.invoiceId, attempt: pending.attempt, notice, dunning, dryRun, steps: ['notice_retry'] });
        } else {
          log.push({ type: 'skip', invoiceId: open.invoiceId, reason: 'not_due', steps: ['checked'] });
        }
        continue;
      }

      const steps = ['checked'];
      let paid = false;
      let hosted = open.hostedInvoiceUrl || null;
      if (!dryRun && ctx.stripe && ctx.stripe.payInvoice) {
        const res = await ctx.stripe.payInvoice(open.invoiceId, { todayKey });
        steps.push('stripe_pay');
        paid = res.paid === true;
        hosted = res.hostedInvoiceUrl || hosted;
      } else if (open.outcome === 'paid') {
        paid = true;
        steps.push('injected_paid');
      } else if (open.outcome === 'failed') {
        steps.push('injected_failed');
      } else if (dryRun) {
        log.push({ type: 'dry_run_skip', invoiceId: open.invoiceId, reason: 'no_charge_in_dry_run', steps, dryRun });
        continue;
      } else {
        log.push({ type: 'failure', invoiceId: open.invoiceId, message: 'no stripe pay client', steps });
        await alert('failure', open.siteName, `No Stripe client for ${open.invoiceId}`);
        continue;
      }

      if (paid) {
        const dunning = recordPaid(current, { todayKey });
        steps.push('marked_paid');
        await persist(open.invoiceId, dunning);
        const resume = open.wasPaused ? resumePlan(open.resume || {}) : null;
        if (open.wasPaused && ctx.onResume) {
          steps.push('resume');
          await ctx.onResume({ ...open, resume, dryRun });
        }
        log.push({ type: 'paid', invoiceId: open.invoiceId, dunning, resume, steps, dryRun });
        if (open.wasPaused) {
          await alert('resume', open.siteName || open.domain, `Invoice ${open.invoiceId} paid`);
          const link = await payLink(hosted || open.manageUrl);
          await clientSms(open, smsResume({ business: open.businessName, domain: open.domain, link }));
        }
        continue;
      }

      const fail = recordFailedAttempt(current, { todayKey, hostedInvoiceUrl: hosted });
      steps.push(`attempt_${fail.attempt || current.attemptCount}`);
      await persist(open.invoiceId, fail.record);
      if (fail.notified) {
        const link = await payLink(hosted || 'https://billing.stripe.com');
        const text = buildDunningMessage({
          hostedInvoiceUrl: hosted || 'https://billing.stripe.com',
          attempt: fail.attempt,
          domain: open.domain,
        });
        const sms = smsDunning({
          business: open.businessName,
          domain: open.domain,
          attempt: fail.attempt,
          link,
        });
        const notice = await notify({
          email: open.email,
          phone: open.phone,
          subject: `Payment failed (${fail.attempt} of 10)`,
          text,
          sms,
        });
        const delivered = markNoticeDelivered(fail.record, todayKey);
        await persist(open.invoiceId, delivered);
        steps.push('notified');
        log.push({ type: 'failed', invoiceId: open.invoiceId, ...fail, record: delivered, notice, steps, dryRun });
      } else {
        log.push({ type: 'failed', invoiceId: open.invoiceId, ...fail, steps, dryRun });
      }

      if (fail.closed) {
        if (!dryRun && ctx.stripe && ctx.stripe.markUncollectible) {
          await ctx.stripe.markUncollectible(open.invoiceId);
          steps.push('uncollectible');
        } else {
          steps.push('uncollectible_local');
        }
        const pause = pausePlan({ plan: open.plan, domainRenewalDue: open.domainRenewalDue === true });
        log.push({ type: 'unpaid_final', invoiceId: open.invoiceId, plan: open.plan, pause, steps, dryRun });
        if (ctx.onPause) await ctx.onPause({ ...open, pause, dryRun });
        await alert('pause', open.siteName || open.domain, `Invoice ${open.invoiceId} unpaid after 10 days`);
        const pauseLink = await payLink(hosted || 'https://billing.stripe.com');
        await clientSms(open, smsPause({ business: open.businessName, domain: open.domain, link: pauseLink }));
      }
    } catch (err) {
      log.push({ type: 'failure', invoiceId: open.invoiceId, message: err.message, steps: ['error'] });
      if (ctx.onAlert) await ctx.onAlert(buildAlertMessage({ kind: 'failure', siteName: open.siteName, detail: err.message }));
      await alert('failure', open.siteName, err.message);
    }
  }

  for (const account of ctx.accounts || []) {
    try {
      const steps = ['loaded'];
      const drift = reconcileDrift({
        stripeStatus: account.stripeStatus,
        localPaused: account.localPaused === true,
        plan: account.plan,
        domainRenewalDue: account.domainRenewalDue === true,
      });
      steps.push('reconciled');
      if (drift.action === 'pause') {
        log.push({ type: 'reconcile_pause', accountId: account.id, ...drift, steps, dryRun });
        if (ctx.onPause) await ctx.onPause({ ...account, pause: drift, dryRun });
        await alert('pause', account.siteName || account.domain, `Subscription ${account.id} is ${account.stripeStatus}`);
        const pauseLink = await payLink(account.hostedInvoiceUrl || account.manageUrl);
        await clientSms(account, smsPause({ business: account.businessName, domain: account.domain, link: pauseLink }));
      } else if (drift.action === 'resume') {
        const resume = resumePlan(account.resume || {});
        steps.push('resume');
        log.push({ type: 'reconcile_resume', accountId: account.id, resume, steps, dryRun });
        if (ctx.onResume) await ctx.onResume({ ...account, resume, dryRun });
        await alert('resume', account.siteName || account.domain, `Subscription ${account.id} is active`);
        const resumeLink = await payLink(account.manageUrl || account.hostedInvoiceUrl);
        await clientSms(account, smsResume({ business: account.businessName, domain: account.domain, link: resumeLink }));
      }

      if (account.plan === 'one_off' && account.renewalAt) {
        let sent = [...(account.remindersSent || [])];
        const days = dueReminderDays(account.renewalAt, now, sent);
        for (const day of days) {
          let manageUrl = account.manageUrl || '';
          if (!manageUrl && !dryRun && ctx.stripe && ctx.stripe.portalUrl && account.customerId) {
            manageUrl = (await ctx.stripe.portalUrl(account.customerId)) || '';
            steps.push('portal');
          }
          const link = await payLink(manageUrl);
          const whenLabel = smsWhen(account.renewalAt);
          const text = buildReminderMessage({
            whenLabel,
            priceLabel: account.priceLabel || '',
            manageUrl: link,
            domain: account.domain,
          });
          const sms = smsReminder({
            business: account.businessName,
            domain: account.domain,
            days: day,
            whenLabel,
            priceLabel: account.priceLabel || '',
            link,
          });
          const notice = await notify({
            email: account.email,
            phone: account.phone,
            subject: `Domain renewal in ${day} days`,
            text,
            sms,
          });
          sent = [...sent, day];
          log.push({
            type: 'reminder',
            accountId: account.id,
            days: day,
            notice,
            remindersSent: sent,
            steps: [...steps, 'reminded'],
            dryRun,
          });
        }
      }

      if (account.plan === 'monthly' && account.domainRenewsAt) {
        const renew = shouldRenewDomainOnPaidInvoice({
          plan: 'monthly',
          billingReason: 'subscription_cycle',
          domainRenewsAt: account.domainRenewsAt,
          now,
          lastRenewedFor: account.lastRenewedFor,
        });
        if (renew && account.stripeStatus === 'active') {
          log.push({ type: 'monthly_domain_renew', accountId: account.id, dryRun, steps: [...steps, 'renew'] });
          if (!dryRun && ctx.onRenew) {
            await ctx.onRenew(account);
            steps.push('renew_called');
          }
        }
        if (isTerminalUnpaidStatus(account.stripeStatus) && renew) {
          log.push({
            type: 'monthly_domain_lapse',
            accountId: account.id,
            detachDomain: true,
            renewAtRegistrar: false,
            dryRun,
            steps: [...steps, 'lapse'],
          });
        }
      }
    } catch (err) {
      log.push({ type: 'failure', accountId: account.id, message: err.message, steps: ['error'] });
      await alert('failure', account.siteName || account.domain, err.message);
    }
  }

  return { todayKey, dryRun, log };
}
