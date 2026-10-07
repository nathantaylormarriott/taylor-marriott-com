import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'checkout.json');
const DEFAULT_SITE_AMOUNT_PENCE = 29900;
export const DEFAULT_RENEWAL_LEAD_DAYS = 30;
const MIN_RENEWAL_LEAD_DAYS = 1;
const MAX_RENEWAL_LEAD_DAYS = 180;

function pickLeadDays(v) {
  return Number.isInteger(v) && v >= MIN_RENEWAL_LEAD_DAYS && v <= MAX_RENEWAL_LEAD_DAYS ? v : null;
}

export function isHttpUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' || x.protocol === 'http:';
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function resolveUsdToGbp({ env = process.env, raw = {}, overrides = {} } = {}) {
  const envRate = env && env.CHECKOUT_USD_TO_GBP != null ? String(env.CHECKOUT_USD_TO_GBP).trim() : '';
  if (envRate) {
    const n = Number(envRate);
    if (Number.isFinite(n) && n > 0) return { rate: n, source: 'env:CHECKOUT_USD_TO_GBP' };
  }
  const fromOverride = overrides.usdToGbp ?? overrides.domainPricing?.usdToGbp;
  if (fromOverride != null && fromOverride !== '') {
    const n = Number(fromOverride);
    if (Number.isFinite(n) && n > 0) return { rate: n, source: 'override' };
  }
  const fromFile = raw.domainPricing?.usdToGbp;
  if (fromFile != null && fromFile !== '') {
    const n = Number(fromFile);
    if (Number.isFinite(n) && n > 0) return { rate: n, source: 'config:domainPricing.usdToGbp' };
  }
  return { rate: null, source: null };
}

/**
 * @param {{ env?: object, configPath?: string, overrides?: object }} [opts]
 */
export function loadCheckoutConfig({ env = process.env, configPath, overrides = {} } = {}) {
  const file = configPath || (env && env.CHECKOUT_CONFIG) || CONFIG_PATH;
  const raw = readJson(file);
  const envBase = env && typeof env.CHECKOUT_BASE_URL === 'string' ? env.CHECKOUT_BASE_URL.trim() : '';
  const baseCandidate =
    overrides.checkoutBaseUrl !== undefined
      ? overrides.checkoutBaseUrl
      : envBase || raw.checkoutBaseUrl || null;
  const checkoutBaseUrl = baseCandidate && isHttpUrl(baseCandidate) ? String(baseCandidate).trim() : null;
  const siteAmountPence = Number.isInteger(overrides.siteAmountPence)
    ? overrides.siteAmountPence
    : Number.isInteger(raw.siteAmountPence)
      ? raw.siteAmountPence
      : DEFAULT_SITE_AMOUNT_PENCE;

  const { rate: usdToGbp, source: usdToGbpSource } = resolveUsdToGbp({ env, raw, overrides });

  return {
    siteAmountPence,
    currency: 'gbp',
    checkoutBaseUrl,
    offeredTlds:
      Array.isArray(raw.offeredTlds) && raw.offeredTlds.length
        ? raw.offeredTlds.slice()
        : ['com', 'co.uk', 'uk', 'net', 'org'],
    domainPricing: {
      ...(raw.domainPricing || {}),
      ...(overrides.domainPricing || {}),
      usdToGbp,
    },
    usdToGbp,
    usdToGbpSource,
    renewalLeadDays:
      pickLeadDays(overrides.renewalLeadDays) ||
      pickLeadDays(raw.renewalLeadDays) ||
      DEFAULT_RENEWAL_LEAD_DAYS,
    source: { file, checkoutBaseUrl: envBase ? 'env' : raw.checkoutBaseUrl ? 'config' : null },
  };
}

export function tldOf(domainOrTld) {
  const s = String(domainOrTld || '').toLowerCase().replace(/^\.+/, '');
  for (const two of ['co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk']) {
    if (s === two || s.endsWith(`.${two}`)) return two;
  }
  const parts = s.split('.');
  return parts[parts.length - 1];
}

function usdToCents(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  const [dollars, frac = ''] = s.split('.');
  return Number(dollars) * 100 + Number((frac + '00').slice(0, 2));
}

/**
 * Live Porkbun → client yearly price in GBP pence (no markup; FX only).
 */
export function livePorkbunClientPricePence(quote = {}, config = {}) {
  const tld = tldOf(quote.tld || quote.domain);
  const rate = config.usdToGbp ?? config.domainPricing?.usdToGbp;
  if (!Number.isFinite(rate) || rate <= 0) {
    return { pence: null, tld, reason: 'usdToGbp_not_set', basis: null };
  }

  const reg = usdToCents(quote.registrationUsd ?? quote.price ?? quote.registration);
  const ren = usdToCents(quote.renewalUsd ?? quote.renewalPrice ?? quote.renewal);
  const costCents = Math.max(reg || 0, ren || 0);
  if (!costCents) {
    return { pence: null, tld, reason: 'no_registrar_price', basis: null };
  }

  const dp = config.domainPricing || {};
  const step = Number.isInteger(dp.roundUpToPence) && dp.roundUpToPence > 0 ? dp.roundUpToPence : 1;
  let pence = Math.ceil(costCents * rate);
  pence = Math.ceil(pence / step) * step;
  const min = Number.isInteger(dp.minimumPence) ? dp.minimumPence : 30;
  if (pence < min) pence = min;
  if (pence < 30) pence = 30;

  return {
    pence,
    tld,
    reason: null,
    basis: 'ceil(max(registration, renewal)_usd_cents * usdToGbp)',
    usdBasisCents: costCents,
    usdToGbp: rate,
  };
}

export function formatGbp(pence) {
  if (!Number.isInteger(pence)) return null;
  return `£${(pence / 100).toFixed(2)}`;
}
