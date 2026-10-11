import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tldOf } from './checkout-config.js';
import { priceToCents } from './porkbun-client.js';
import { includedMaxPenceFromGbp, isYearlyPriceIncludedInPackage, PACKAGE_EXCLUDED_LABEL } from '../../../shared/domain-package.js';

export { PACKAGE_EXCLUDED_LABEL, isYearlyPriceIncludedInPackage };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.join(__dirname, '..', '..', '..', 'config', 'domain-pricing.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Fixed retail yearly domain prices (GBP pence). Not pass-through Porkbun cost.
 */
export function loadDomainPricingConfig({ configPath, env = process.env } = {}) {
  const file = configPath || (env && env.DOMAIN_PRICING_CONFIG) || DEFAULT_PATH;
  const raw = readJson(file);
  const byTld = { ...(raw.yearlyPenceByTld || {}) };
  const envMax = env && env.DOMAIN_INCLUDED_MAX_GBP != null ? String(env.DOMAIN_INCLUDED_MAX_GBP).trim() : '';
  const includedMaxYearlyGbp = envMax
    ? Number(envMax)
    : Number.isFinite(Number(raw.includedMaxYearlyGbp))
      ? Number(raw.includedMaxYearlyGbp)
      : 20;
  const includedMaxPence = includedMaxPenceFromGbp(includedMaxYearlyGbp);
  return {
    file,
    currency: raw.currency || 'gbp',
    yearlyPenceByTld: byTld,
    defaultYearlyPence: Number.isInteger(raw.defaultYearlyPence) ? raw.defaultYearlyPence : 2000,
    includedMaxYearlyGbp,
    includedMaxPence,
  };
}

export function fixedYearlyPenceForDomain(domain, pricing = loadDomainPricingConfig()) {
  const tld = tldOf(domain);
  const p = pricing.yearlyPenceByTld[tld];
  if (Number.isInteger(p) && p > 0) return { tld, pence: p };
  const d = pricing.defaultYearlyPence;
  if (Number.isInteger(d) && d > 0) return { tld, pence: d };
  return { tld, pence: null };
}

export const COST_GUARD_TOLERANCE = 0.1;

/**
 * Refuse when live Porkbun cost (USD cents, max reg/renew) exceeds what we charge the client
 * (domain_amount_pence ÷ usdToGbp, +margin).
 */
export function maxPorkbunCostCentsForClientPrice(domainAmountPence, usdToGbp, tolerance = COST_GUARD_TOLERANCE) {
  if (!Number.isInteger(domainAmountPence) || !Number.isFinite(usdToGbp) || usdToGbp <= 0) return null;
  return Math.floor((domainAmountPence / usdToGbp) * (1 + tolerance));
}

export function porkbunQuoteCostCents(quote = {}) {
  const reg = priceToCents(quote.price ?? quote.registrationUsd ?? quote.registration);
  const ren = priceToCents(quote.renewalPrice ?? quote.renewalUsd ?? quote.renewal);
  const cost = Math.max(reg || 0, ren || 0);
  return Number.isInteger(cost) && cost > 0 ? cost : null;
}

export function assertPorkbunWithinClientPrice(quote, domainAmountPence, usdToGbp) {
  const costCents = porkbunQuoteCostCents(quote);
  if (!costCents) {
    const err = new Error('No Porkbun price for guard check');
    err.code = 'NO_REGISTRAR_PRICE';
    throw err;
  }
  const maxCost = maxPorkbunCostCentsForClientPrice(domainAmountPence, usdToGbp);
  if (maxCost != null && costCents > maxCost) {
    const err = new Error(`Porkbun cost ${costCents}c exceeds client price guard ${maxCost}c`);
    err.code = 'COST_ABOVE_CLIENT_PRICE';
    err.costCents = costCents;
    err.maxCostCents = maxCost;
    throw err;
  }
  return { costCents, maxCostCents: maxCost };
}
