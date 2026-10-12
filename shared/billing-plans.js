/** Checkout plans: £299 one-off and £39/month. Amounts are GBP pence. */

export const PLAN_ONE_OFF = 'one_off';
export const PLAN_MONTHLY = 'monthly';

export const ONE_OFF_PENCE = 29900;
export const MONTHLY_PENCE = 3900;
export const ONE_OFF_DOMAIN_INCLUDED_PENCE = 2000;
export const MONTHLY_DOMAIN_INCLUDED_PENCE = 3900;

export function normalizePlan(plan) {
  return plan === PLAN_MONTHLY ? PLAN_MONTHLY : PLAN_ONE_OFF;
}

export function domainExcessPence(yearlyPence, allowancePence) {
  const yearly = Number(yearlyPence);
  const allowance = Number(allowancePence);
  if (!Number.isInteger(yearly) || yearly < 0) return 0;
  if (!Number.isInteger(allowance) || allowance < 0) return 0;
  return Math.max(0, yearly - allowance);
}

export function allowanceForPlan(plan) {
  return normalizePlan(plan) === PLAN_MONTHLY
    ? MONTHLY_DOMAIN_INCLUDED_PENCE
    : ONE_OFF_DOMAIN_INCLUDED_PENCE;
}

export function planBasePence(plan) {
  return normalizePlan(plan) === PLAN_MONTHLY ? MONTHLY_PENCE : ONE_OFF_PENCE;
}

/** What the client pays on the first invoice (website fee plus any domain excess). */
export function firstInvoicePence(plan, yearlyPence = 0) {
  const p = normalizePlan(plan);
  const excess = domainExcessPence(yearlyPence, allowanceForPlan(p));
  return planBasePence(p) + excess;
}

export function formatGbpPence(pence) {
  if (!Number.isInteger(pence)) return '';
  return `£${(pence / 100).toFixed(2)}`;
}

export function oneOffRenewalCopy(yearlyPence, whenLabel) {
  const yearly = formatGbpPence(yearlyPence);
  const excess = domainExcessPence(yearlyPence, ONE_OFF_DOMAIN_INCLUDED_PENCE);
  const when = whenLabel || 'the anniversary';
  if (!yearly) return '';
  if (excess === 0) {
    return `First year included. Then ${yearly}/year from ${when}. We remind you before we charge the card on file. Cancel anytime.`;
  }
  const extra = formatGbpPence(excess);
  return `${extra} added today because this domain is above the £20 included in the £299. Then ${yearly}/year from ${when}. We remind you before we charge the card on file. Cancel anytime.`;
}

export function monthlyDomainCopy(yearlyPence) {
  const yearly = formatGbpPence(yearlyPence);
  const excess = domainExcessPence(yearlyPence, MONTHLY_DOMAIN_INCLUDED_PENCE);
  if (!yearly) {
    return '£39/month. No minimum term. Cancel anytime. If a payment stays unpaid the site is paused.';
  }
  if (excess === 0) {
    return `The first £39 covers this domain (up to £39). Renewals stay inside the £39 that month, with no separate domain charge. Renewal price if billed on its own: ${yearly}/year.`;
  }
  const extra = formatGbpPence(excess);
  return `${extra} is added to the first invoice because this domain is above £39. After that, renewals stay inside the £39 that month, with no separate domain charge. Renewal price if billed on its own: ${yearly}/year.`;
}
