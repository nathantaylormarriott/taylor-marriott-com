/** £299 package: first year of domain included when yearly retail ≤ included max. */

export const PACKAGE_EXCLUDED_LABEL = 'Not available in this package';

export function includedMaxPenceFromGbp(gbp) {
  const n = Number(gbp);
  if (!Number.isFinite(n) || n < 0) return 2000;
  return Math.round(n * 100);
}

export function isYearlyPriceIncludedInPackage(yearlyPence, includedMaxPence) {
  if (!Number.isInteger(yearlyPence) || !Number.isInteger(includedMaxPence)) return false;
  return yearlyPence <= includedMaxPence;
}

export function renewalMonthYear(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setFullYear(d.getFullYear() + 1);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

export function formatGbpPence(pence) {
  if (!Number.isInteger(pence)) return null;
  return `£${(pence / 100).toFixed(2)}`;
}

export function domainRenewalUpfrontCopy(yearlyPence, fromDate = new Date()) {
  const when = renewalMonthYear(fromDate);
  const yearly = formatGbpPence(yearlyPence);
  if (!yearly) return null;
  return `First year included. Then ${yearly}/year from ${when}, cancel anytime.`;
}

export function stripeSubmitMessage(domain, yearlyPence, fromDate = new Date()) {
  const when = renewalMonthYear(fromDate);
  const yearly = formatGbpPence(yearlyPence);
  return `Your £299 payment includes the website and the first year of ${domain}. Domain renewal is ${yearly}/year from ${when} unless you cancel.`;
}

/** Stripe subscription trial: first domain charge at 1-year anniversary. */
export const DOMAIN_FIRST_YEAR_TRIAL_DAYS = 365;
