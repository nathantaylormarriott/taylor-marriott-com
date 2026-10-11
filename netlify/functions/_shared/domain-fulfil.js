/**
 * After a paid Stripe checkout with a domain:
 *   1. re-check the domain at Porkbun (available, not premium, cost within what the client paid)
 *   2. find the client's Netlify site from the place_id
 *   3. register the domain at Porkbun, then turn Porkbun auto-renew off
 *   4. point DNS at Netlify (Porkbun ALIAS @ -> apex-loadbalancer.netlify.com, CNAME www -> <site>.netlify.app)
 *   5. set the Netlify custom domain + www alias, then ask Netlify for the SSL cert
 *
 * Two kill switches, both OFF unless exactly "1":
 *   DOMAIN_PURCHASE_LIVE=1  step 3 really registers (spends Porkbun credit). Also needs a live-mode
 *                           Stripe event: a test-mode payment never buys a real domain.
 *   DOMAIN_CONNECT_LIVE=1   steps 4-5 really change DNS / Netlify. Only for a domain that is
 *                           actually registered.
 * With a switch off, the step's exact request is built and recorded (secrets as env names), not sent.
 * Steps 1-2 are read-only and always run.
 */
import * as porkbun from './porkbun-client.js';
import * as netlify from './netlify-sites.js';
import { SITE_PRODUCT_TYPE } from './domain-checkout.js';

export const FX_TOLERANCE = 0.1;

export function switchesFromEnv(env = process.env) {
  return {
    purchaseLive: env.DOMAIN_PURCHASE_LIVE === '1',
    connectLive: env.DOMAIN_CONNECT_LIVE === '1',
  };
}

export function idempotencyKeyFor(sessionId) {
  return `tm-domain-${sessionId}`;
}

/**
 * Pull the order out of a checkout.session.completed event. Returns null for events
 * that are not ours or have nothing to register (website-only payments).
 */
export function orderFromEvent(event) {
  if (!event || event.type !== 'checkout.session.completed') return null;
  const s = event.data && event.data.object;
  if (!s || s.object !== 'checkout.session') return null;
  const m = s.metadata || {};
  if (m.product_type !== SITE_PRODUCT_TYPE) return null;
  if (s.payment_status !== 'paid') return null;
  const domain = String(m.domain || '').trim();
  if (!domain) return null;
  return {
    eventId: event.id,
    livemode: event.livemode === true && s.livemode === true,
    sessionId: s.id,
    placeId: m.place_id || s.client_reference_id || null,
    domain: porkbun.normalizeDomain(domain),
    domainAmountPence: Number.isInteger(Number(m.domain_amount_pence)) ? Number(m.domain_amount_pence) : null,
    customerEmail: (s.customer_details && s.customer_details.email) || s.customer_email || null,
    subscriptionId: s.subscription || null,
    amountTotal: s.amount_total ?? null,
    currency: s.currency || null,
  };
}

function maxCostCentsFor(order, usdToGbp) {
  if (!Number.isInteger(order.domainAmountPence) || !Number.isFinite(usdToGbp) || usdToGbp <= 0) return null;
  return Math.floor((order.domainAmountPence / usdToGbp) * (1 + FX_TOLERANCE));
}

/**
 * @param {object} order from orderFromEvent
 * @param {{ purchaseLive?: boolean, connectLive?: boolean, usdToGbp?: number,
 *           alreadyRegistered?: boolean, deps?: { porkbun?, netlify? } }} opts
 */
export async function fulfilDomainOrder(order, opts = {}) {
  const pb = { ...porkbun, ...(opts.deps && opts.deps.porkbun) };
  const nf = { ...netlify, ...(opts.deps && opts.deps.netlify) };
  const purchaseLive = opts.purchaseLive === true && order.livemode === true;
  const steps = [];
  const out = { domain: order.domain, placeId: order.placeId, sessionId: order.sessionId, steps };
  const step = (id, mode, extra = {}) => {
    const s = { id, mode, ...extra };
    steps.push(s);
    return s;
  };

  try {
    // 1. Live quote (read only)
    let costCents = null;
    if (opts.alreadyRegistered) {
      step('porkbun_quote', 'skipped', { note: 'already registered in an earlier run' });
    } else {
      const quote = await pb.checkDomain(order.domain);
      costCents = pb.priceToCents(quote.price);
      const maxCost = maxCostCentsFor(order, opts.usdToGbp);
      const s = step('porkbun_quote', 'live_read', {
        result: { available: quote.available, premium: quote.premium, costCents, maxCostCents: maxCost },
      });
      const fail = (code, msg) => {
        const err = new Error(msg);
        err.code = code;
        s.error = code;
        throw err;
      };
      if (quote.available !== true) fail('NOT_AVAILABLE', `${order.domain} is no longer available`);
      if (quote.premium === true) fail('PREMIUM_REFUSED', `${order.domain} is a premium name`);
      if (!Number.isInteger(costCents) || costCents <= 0) fail('NO_PRICE', `No Porkbun price for ${order.domain}`);
      if (costCents > pb.PORKBUN_API_ORDER_CAP_CENTS) fail('COST_TOO_HIGH', `Over Porkbun's $100 API cap`);
      if (maxCost != null && costCents > maxCost) {
        fail('COST_ABOVE_PAID', `Porkbun now wants ${costCents}c, client paid for up to ${maxCost}c`);
      }
    }

    // 2. Which Netlify site (read only)
    const site = await nf.resolveClientSite(order.placeId);
    const host = nf.siteHostname(site);
    step('resolve_netlify_site', 'live_read', {
      result: { siteId: site.siteId, siteName: site.siteName, host, source: site.source, currentCustomDomain: site.customDomain },
    });
    if (site.customDomain && site.customDomain !== order.domain) {
      const err = new Error(`Site ${site.siteName} already uses ${site.customDomain}`);
      err.code = 'SITE_HAS_OTHER_DOMAIN';
      steps[steps.length - 1].error = err.code;
      throw err;
    }

    // 3. Register
    let registeredNow = false;
    const idem = idempotencyKeyFor(order.sessionId);
    if (opts.alreadyRegistered) {
      step('porkbun_register', 'skipped', { note: 'already registered' });
    } else {
      const request = pb.buildCreateDomainRequest(order.domain, costCents, { idempotencyKey: idem });
      if (purchaseLive) {
        const result = await pb.createDomain({ domain: order.domain, costCents, idempotencyKey: idem, confirmSpend: true });
        step('porkbun_register', 'live', { request, result });
        registeredNow = true;
        out.registered = true;
        const ar = await pb.setAutoRenewOff(order.domain);
        step('porkbun_auto_renew_off', 'live', { result: ar });
      } else {
        step('porkbun_register', 'dry_run', {
          request,
          preflight: pb.buildCreateDomainRequest(order.domain, costCents, { dryRun: true }),
          reason: opts.purchaseLive && !order.livemode ? 'test-mode Stripe payment' : 'DOMAIN_PURCHASE_LIVE is off',
        });
        step('porkbun_auto_renew_off', 'dry_run', {
          request: { method: 'POST', url: `https://api.porkbun.com/api/json/v3/domain/updateAutoRenew/${order.domain}`, body: { status: 'off' } },
        });
      }
    }
    const registered = registeredNow || opts.alreadyRegistered === true;
    out.registered = registered;

    // 4. DNS at Porkbun -> Netlify
    const wanted = pb.netlifyDnsRecords(host);
    const connectLive = opts.connectLive === true && registered;
    if (connectLive) {
      const existing = await pb.retrieveDnsRecords(order.domain);
      const clash = pb.conflictingDnsRecords(order.domain, existing);
      const already = (r) =>
        existing.some(
          (e) =>
            String(e.type).toUpperCase() === r.type &&
            String(e.name).toLowerCase() === (r.name ? `${r.name}.${order.domain}` : order.domain) &&
            String(e.content).toLowerCase().replace(/\.$/, '') === r.content,
        );
      const deleted = [];
      for (const r of clash) {
        const keep = wanted.some(
          (w) => String(r.type).toUpperCase() === w.type && String(r.content).toLowerCase().replace(/\.$/, '') === w.content &&
            String(r.name).toLowerCase() === (w.name ? `${w.name}.${order.domain}` : order.domain),
        );
        if (!keep) deleted.push(await pb.deleteDnsRecord(order.domain, r.id));
      }
      const created = [];
      for (const r of wanted) if (!already(r)) created.push(await pb.createDnsRecord(order.domain, r));
      step('porkbun_dns', 'live', { result: { deleted, created } });
    } else {
      step('porkbun_dns', 'dry_run', {
        plan: {
          deleteFirst: 'Any A/AAAA/ALIAS/CNAME on @, www or * (Porkbun parks new domains with ALIAS @ and CNAME * -> pixie.porkbun.com). MX/TXT kept.',
          create: wanted.map((r) => ({
            method: 'POST',
            url: `https://api.porkbun.com/api/json/v3/dns/create/${order.domain}`,
            body: { apikey: '<PORKBUN_API_KEY>', secretapikey: '<PORKBUN_SECRET_API_KEY>', name: r.name, type: r.type, content: r.content, ttl: String(r.ttl) },
          })),
        },
        reason: !registered ? 'domain not registered in this run' : 'DOMAIN_CONNECT_LIVE is off',
      });
    }

    // 5. Netlify custom domain + SSL
    const attach = nf.buildAttachDomainRequest(site, order.domain);
    const ssl = nf.buildProvisionSslRequest(site);
    if (connectLive) {
      const r = await nf.netlifyApi(attach.path, { method: 'PATCH', body: attach.body });
      step('netlify_attach_domain', 'live', { request: attach, result: { custom_domain: r && r.custom_domain, domain_aliases: r && r.domain_aliases } });
      try {
        await nf.netlifyApi(ssl.path, { method: 'POST' });
        step('netlify_ssl', 'live', { result: 'requested' });
      } catch (e) {
        // Normal until DNS has propagated; Netlify retries the certificate on its own.
        step('netlify_ssl', 'live', { result: 'pending_dns', note: e.message });
      }
      out.status = 'connected';
    } else {
      step('netlify_attach_domain', 'dry_run', { request: attach });
      step('netlify_ssl', 'dry_run', { request: ssl });
      out.status = registered ? 'registered' : 'dry_run';
    }
    return out;
  } catch (err) {
    out.status = 'error';
    out.error = { code: err.code || 'ERROR', message: err.message };
    return out;
  }
}
