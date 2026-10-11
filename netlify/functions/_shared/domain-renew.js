/**
 * Yearly domain renewal after Stripe bills the client's saved card (invoice.paid, subscription_cycle).
 * Porkbun auto-renew stays OFF — we renew only when the client has paid.
 */
import * as porkbun from './porkbun-client.js';
import { SITE_PRODUCT_TYPE } from './domain-checkout.js';
import { maxPorkbunCostCentsForClientPrice } from './domain-pricing.js';
import { switchesFromEnv } from './domain-fulfil.js';

export function idempotencyKeyForRenewal(invoiceId) {
  return `tm-domain-renew-${invoiceId}`;
}

function subscriptionMetadataFromInvoice(invoice) {
  const fromSub =
    (invoice.subscription_details && invoice.subscription_details.metadata) ||
    (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.metadata) ||
    null;
  if (fromSub && Object.keys(fromSub).length) return fromSub;
  return invoice.metadata || {};
}

/**
 * @returns {object|null} renewal job payload
 */
export function renewalFromInvoiceEvent(event) {
  if (!event || event.type !== 'invoice.paid') return null;
  const inv = event.data && event.data.object;
  if (!inv || inv.object !== 'invoice') return null;
  if (inv.billing_reason !== 'subscription_cycle') return null;
  if (inv.status !== 'paid' && inv.paid !== true) return null;

  const m = subscriptionMetadataFromInvoice(inv);
  if (m.product_type !== SITE_PRODUCT_TYPE) return null;
  const domain = String(m.domain || '').trim();
  if (!domain) return null;

  const domainAmountPence = Number.isInteger(Number(m.domain_amount_pence)) ? Number(m.domain_amount_pence) : null;

  return {
    eventId: event.id,
    livemode: event.livemode === true && inv.livemode === true,
    invoiceId: inv.id,
    subscriptionId: inv.subscription || null,
    placeId: m.place_id || null,
    domain: porkbun.normalizeDomain(domain),
    tld: m.tld || null,
    domainAmountPence,
    netlifySiteId: m.netlify_site_id || null,
    netlifySiteName: m.netlify_site_name || null,
  };
}

/**
 * @param {object} job from renewalFromInvoiceEvent
 */
export async function fulfilDomainRenewal(job, opts = {}) {
  const pb = { ...porkbun, ...(opts.deps && opts.deps.porkbun) };
  const purchaseLive = opts.purchaseLive === true && job.livemode === true;
  const steps = [];
  const out = { invoiceId: job.invoiceId, domain: job.domain, subscriptionId: job.subscriptionId, steps };
  const step = (id, mode, extra = {}) => {
    const s = { id, mode, ...extra };
    steps.push(s);
    return s;
  };

  if (opts.subscriptionLapsing === true) {
    step('subscription', 'skipped', { reason: 'subscription lapsing — no Porkbun renew' });
    out.status = 'skipped_lapsing';
    return out;
  }

  try {
    const quote = await pb.checkDomain(job.domain);
    const costCents = pb.priceToCents(quote.price ?? quote.renewalPrice);
    const renewCost = pb.priceToCents(quote.renewalPrice ?? quote.price) ?? costCents;
    const s = step('porkbun_quote', 'live_read', {
      result: { available: quote.available, premium: quote.premium, renewCostCents: renewCost },
    });
    // Registered domains are not "available"; renewal only needs a renewal quote.
    if (quote.premium === true) {
      const err = new Error(`${job.domain} is premium`);
      err.code = 'PREMIUM_REFUSED';
      s.error = err.code;
      throw err;
    }
    if (!Number.isInteger(renewCost) || renewCost <= 0) {
      const err = new Error(`No Porkbun renewal price for ${job.domain}`);
      err.code = 'NO_PRICE';
      s.error = err.code;
      throw err;
    }
    if (renewCost > pb.PORKBUN_API_ORDER_CAP_CENTS) {
      const err = new Error(`Over Porkbun API cap`);
      err.code = 'COST_TOO_HIGH';
      s.error = err.code;
      throw err;
    }
    const maxCost = maxPorkbunCostCentsForClientPrice(job.domainAmountPence, opts.usdToGbp);
    if (maxCost != null && renewCost > maxCost) {
      const err = new Error(`Renewal cost ${renewCost}c above client guard ${maxCost}c`);
      err.code = 'COST_ABOVE_PAID';
      s.error = err.code;
      throw err;
    }

    const idem = idempotencyKeyForRenewal(job.invoiceId);
    const request = pb.buildRenewDomainRequest(job.domain, renewCost, { years: 1 });
    if (purchaseLive) {
      const result = await pb.renewDomain({
        domain: job.domain,
        costCents: renewCost,
        years: 1,
        idempotencyKey: idem,
        confirmSpend: true,
      });
      step('porkbun_renew', 'live', { request, result });
      out.status = 'renewed';
    } else {
      step('porkbun_renew', 'dry_run', {
        request,
        preflight: pb.buildRenewDomainRequest(job.domain, renewCost, { years: 1, dryRun: true }),
        reason: opts.purchaseLive && !job.livemode ? 'test-mode Stripe invoice' : 'DOMAIN_PURCHASE_LIVE is off',
      });
      out.status = 'dry_run';
    }
    return out;
  } catch (err) {
    out.status = 'error';
    out.error = { code: err.code || 'ERROR', message: err.message };
    console.error('[domain-renew]', job.invoiceId, job.domain, out.error);
    return out;
  }
}

export function subscriptionDeletedFromEvent(event) {
  if (!event || event.type !== 'customer.subscription.deleted') return null;
  const sub = event.data && event.data.object;
  if (!sub || sub.object !== 'subscription') return null;
  const m = sub.metadata || {};
  if (m.product_type !== SITE_PRODUCT_TYPE) return null;
  return {
    eventId: event.id,
    subscriptionId: sub.id,
    domain: m.domain ? porkbun.normalizeDomain(m.domain) : null,
    placeId: m.place_id || null,
    status: sub.status || 'canceled',
  };
}

export { switchesFromEnv };
