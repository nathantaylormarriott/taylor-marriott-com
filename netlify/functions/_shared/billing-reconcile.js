/**
 * Walk site_checkout subscriptions page by page and run one billing day.
 * Dry-run does not persist dunning, charge a card, or change a client site.
 */
import { londonDateKey } from '../../../shared/billing-lifecycle.js';
import { accountFromSubscription, openInvoiceFromAccount } from './billing-stripe.js';
import { applySiteChange } from './billing-actions.js';
import { runBillingDay } from './billing-run.js';

export function mergeStoredAccount(live, stored, now = new Date()) {
  const base = stored || {};
  const domainRenewsAt = base.domainRenewsAt || live.domainRenewsAt || null;
  const renewalAt = base.renewalAt || live.renewalAt || null;
  return {
    ...live,
    email: live.email || base.email || null,
    phone: live.phone || base.phone || null,
    localPaused: base.localPaused === true,
    remindersSent: Array.isArray(base.remindersSent) ? base.remindersSent : [],
    renewalAt,
    domainRenewsAt,
    lastRenewedFor: base.lastRenewedFor || null,
    manageUrl: base.manageUrl || null,
    priceLabel: base.priceLabel || live.priceLabel || null,
    domainRenewalDue: domainRenewalDue(live.plan, domainRenewsAt, now),
    dunning: null,
  };
}

function domainRenewalDue(plan, domainRenewsAt, now) {
  if (plan !== 'monthly' || !domainRenewsAt) return false;
  return new Date(domainRenewsAt).getTime() <= new Date(now).getTime();
}

async function applyDecision(account, decision, ctx) {
  const applied = await applySiteChange({
    account,
    decision,
    dryRun: ctx.dryRun !== false,
    deps: ctx.dryRun === false ? ctx.deps || {} : {},
  });
  if (ctx.dryRun === false && ctx.putAccount) {
    await ctx.putAccount(account.id, {
      ...account,
      localPaused: decision.pauseSite === true ? true : decision.clearPause === true ? false : account.localPaused,
      lastAction: { at: new Date().toISOString(), steps: applied.steps },
    });
  }
  return applied;
}

export async function reconcileBillingPages(ctx) {
  const maxPages = ctx.maxPages || 20;
  const limit = ctx.limit || 100;
  let page = ctx.page || null;
  const log = [];
  let pages = 0;
  const dryRun = ctx.dryRun !== false;

  for (; pages < maxPages; pages += 1) {
    let listed;
    try {
      listed = await ctx.listPage({ page, limit });
    } catch (err) {
      log.push({ type: 'failure', message: err.message, steps: ['list'], page });
      return { done: false, nextPage: page, log, pages, todayKey: londonDateKey(ctx.now || new Date()), error: err.message };
    }

    const accounts = [];
    const openInvoices = [];
    for (const sub of listed.subscriptions || []) {
      const live = accountFromSubscription(sub);
      if (!live) continue;
      const stored = ctx.getAccount ? await ctx.getAccount(live.id) : null;
      const account = mergeStoredAccount(live, stored, ctx.now || new Date());
      if (account.plan === 'one_off') account.domainRenewalDue = account.domainRenewalDue || false;
      accounts.push(account);
      const open = openInvoiceFromAccount(account);
      if (!open) continue;
      const dunning = ctx.getDunning ? await ctx.getDunning(open.invoiceId) : null;
      openInvoices.push({ ...open, dunning, domainRenewalDue: account.plan === 'one_off' ? true : account.domainRenewalDue });
    }

    const day = await runBillingDay({
      now: ctx.now,
      dryRun,
      openInvoices,
      accounts,
      stripe: dryRun ? null : ctx.stripe,
      sendEmail: ctx.sendEmail,
      sendSms: ctx.sendSms,
      env: ctx.env,
      notifyDryRun: ctx.notifyDryRun === true,
      persistDunning: dryRun
        ? null
        : async (invoiceId, record) => {
            if (ctx.putDunning) await ctx.putDunning(invoiceId, record);
          },
      onRenew: ctx.onRenew,
      onPause: async (row) => {
        const account = {
          ...row,
          id: row.id || row.subscriptionId,
          netlifySiteId: row.netlifySiteId || row.siteId,
        };
        const applied = await applyDecision(account, row.pause, ctx);
        log.push({ type: 'pause_applied', accountId: account.id, applied, dryRun });
        if (ctx.onPause) await ctx.onPause(row);
      },
      onResume: async (row) => {
        const decision = { ...(row.resume || {}), clearPause: true };
        const account = { ...row, id: row.id || row.subscriptionId, netlifySiteId: row.netlifySiteId || row.siteId };
        const applied = await applyDecision(account, decision, ctx);
        log.push({ type: 'resume_applied', accountId: account.id, applied, dryRun });
        if (ctx.onResume) await ctx.onResume(row);
      },
    });

    if (!dryRun && ctx.putAccount) {
      const reminded = new Map();
      for (const row of day.log) {
        if (row.type === 'reminder' && row.accountId) reminded.set(row.accountId, row.remindersSent || []);
      }
      for (const account of accounts) {
        const extra = reminded.get(account.id);
        await ctx.putAccount(account.id, extra ? { ...account, remindersSent: extra } : account);
      }
    }

    log.push(...day.log);
    if (!listed.hasMore) {
      return { done: true, nextPage: null, log, pages: pages + 1, todayKey: day.todayKey, dryRun };
    }
    if (!listed.nextPage || listed.nextPage === page) {
      log.push({ type: 'failure', message: 'Stripe page cursor did not advance', steps: ['list'] });
      return { done: false, nextPage: null, log, pages: pages + 1, todayKey: day.todayKey, dryRun };
    }
    page = listed.nextPage;
  }

  return { done: false, nextPage: page, log, pages, todayKey: londonDateKey(ctx.now || new Date()), dryRun };
}
