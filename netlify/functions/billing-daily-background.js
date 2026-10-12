import { runBillingDay } from './_shared/billing-run.js';
import { reconcileBillingPages } from './_shared/billing-reconcile.js';
import { appendBillingEvent, getAccount, getDunning, putAccount, putDunning } from './_shared/billing-store.js';
import { listSiteCheckoutPage, markInvoiceUncollectible, payInvoice, createPortalUrl } from './_shared/billing-stripe.js';
import { writeClientPauseSwitch } from './_shared/billing-actions.js';
import { netlifyApi } from './_shared/netlify-sites.js';
import { fulfilDomainRenewal } from './_shared/domain-renew.js';
import { sendBillingEmail } from './_shared/billing-gmail.js';
import { sendBillingSms } from './_shared/billing-sms.js';
import { envFlag, readEnv } from './_shared/billing-env.js';

function denied(request) {
  const live = envFlag('BILLING_ACTIONS_LIVE');
  const secret = readEnv('BILLING_CRON_SECRET');
  if (live && !secret) {
    return new Response(JSON.stringify({ error: 'BILLING_CRON_SECRET is required when billing actions are live' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (secret) {
    const auth = request.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  return null;
}

function stripeClient() {
  const key = readEnv('STRIPE_SECRET_KEY');
  return {
    payInvoice: (invoiceId, opts) => payInvoice(invoiceId, { key, todayKey: opts && opts.todayKey }),
    markUncollectible: (invoiceId) => markInvoiceUncollectible(invoiceId, { key }),
    portalUrl: (customerId) =>
      createPortalUrl({ customerId, key, returnUrl: readEnv('URL') || 'https://taylor-marriott.com' }),
  };
}

function notifyDeps() {
  if (!envFlag('BILLING_NOTIFY_LIVE')) return {};
  return {
    sendEmail: (msg) => sendBillingEmail({ ...msg, env: process.env }),
    sendSms: (msg) => sendBillingSms({ to: msg.to, body: msg.body, env: process.env }),
  };
}

/**
 * Background worker. Dry-run unless BILLING_ACTIONS_LIVE=1.
 * A JSON body with openInvoices or accounts replays that page and does not list Stripe.
 * Otherwise the worker pages site_checkout subscriptions and chains the next page.
 */
export default async (request) => {
  const blocked = denied(request);
  if (blocked) return blocked;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const live = envFlag('BILLING_ACTIONS_LIVE');
  const secret = readEnv('BILLING_CRON_SECRET');
  const notify = notifyDeps();
  let result;

  if (Array.isArray(body.openInvoices) || Array.isArray(body.accounts)) {
    result = await runBillingDay({
      now: body.now || new Date(),
      openInvoices: body.openInvoices || [],
      accounts: body.accounts || [],
      dryRun: !live,
      env: process.env,
      stripe: live ? stripeClient() : null,
      ...notify,
    });
  } else if (!readEnv('STRIPE_SECRET_KEY')) {
    result = { todayKey: null, dryRun: true, log: [], skipped: 'no_stripe_key', done: true };
  } else {
    const token = readEnv('NETLIFY_AUTH_TOKEN');
    result = await reconcileBillingPages({
      now: body.now || new Date(),
      page: body.page || null,
      dryRun: !live,
      env: process.env,
      listPage: (query) => listSiteCheckoutPage({ ...query, key: readEnv('STRIPE_SECRET_KEY') }),
      stripe: live ? stripeClient() : null,
      getAccount,
      putAccount,
      getDunning,
      putDunning,
      ...notify,
      deps: {
        netlifyApi,
        writePause: ({ siteId, record }) => writeClientPauseSwitch({ siteId, record, token }),
        reregister: async (account) => {
          if (!envFlag('DOMAIN_PURCHASE_LIVE')) return { mode: 'dry_run', reason: 'DOMAIN_PURCHASE_LIVE is off' };
          const { checkDomain, createDomain, priceToCents } = await import('./_shared/porkbun-client.js');
          const quote = await checkDomain(account.domain);
          if (quote.available !== true || quote.premium === true) return { mode: 'unavailable', quote };
          const costCents = priceToCents(quote.price);
          return createDomain({
            domain: account.domain,
            costCents,
            idempotencyKey: `tm-reregister-${account.id}`,
            confirmSpend: true,
          });
        },
      },
      onRenew: (account) => {
        if (!envFlag('DOMAIN_PURCHASE_LIVE')) return { mode: 'dry_run', reason: 'DOMAIN_PURCHASE_LIVE is off' };
        return fulfilDomainRenewal(
          {
            invoiceId: `monthly-${account.id}-${account.domainRenewsAt}`,
            livemode: true,
            domain: account.domain,
            domainAmountPence: account.domainAmountPence,
            subscriptionId: account.subscriptionId,
          },
          { purchaseLive: true },
        );
      },
    });
    if (!result.done && result.nextPage) {
      const base = readEnv('URL') || new URL(request.url).origin;
      try {
        await fetch(`${base}/api/billing-daily`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
          },
          body: JSON.stringify({ page: result.nextPage }),
        });
      } catch (err) {
        console.error('[billing-daily] chain failed', err.message);
      }
    }
  }

  try {
    await appendBillingEvent({
      id: `day-${result.todayKey || 'na'}-${Date.now()}`,
      kind: 'billing_day',
      dryRun: result.dryRun !== false,
      count: (result.log || []).length,
      done: result.done !== false,
    });
  } catch (err) {
    console.error('[billing-daily] event log', err.message);
  }
  console.info('[billing-daily]', result.todayKey, 'steps', (result.log || []).length, 'dryRun', result.dryRun !== false);
  return new Response(
    JSON.stringify({
      ok: true,
      dryRun: result.dryRun !== false,
      count: (result.log || []).length,
      done: result.done !== false,
      skipped: result.skipped || null,
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  );
};

export const config = {
  path: '/api/billing-daily',
};
