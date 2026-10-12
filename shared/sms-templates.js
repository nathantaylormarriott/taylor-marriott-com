/**
 * Client SMS. Each template stays within 159 basic GSM-7 septets
 * when business, domain, price and the short link are at their caps.
 */
import { assertSmsBody, smsField } from './sms-gsm.js';

export const SHORT_LINK_ORIGIN = 'https://taylor-marriott.com/p/';
export const SHORT_LINK_ID_LENGTH = 8;
export const WORST_BUSINESS = 'S and R Construction and Groundworks Ltd';
export const WORST_DOMAIN = 's-and-r-construction-atherstone.co.uk';
export const WORST_LINK = `${SHORT_LINK_ORIGIN}abcd1234`;
export const WORST_PRICE = '£199.00';
export const WORST_WHEN = '30 Sep 2026';

const BUSINESS_MAX = WORST_BUSINESS.length;
const DOMAIN_MAX = WORST_DOMAIN.length;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pack(body) {
  return assertSmsBody(body.replace(/[ \t]+/g, ' ').trim());
}

export function smsPrice(value) {
  const clean = smsField(value, 24);
  const match = clean.match(/£?\d{1,4}\.\d{2}/);
  if (!match) return clean.slice(0, 8);
  const price = match[0].startsWith('£') ? match[0] : `£${match[0]}`;
  return price.slice(0, 8);
}

export function smsWhen(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return smsField(value, 11);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day').value;
  const month = Number(parts.find((part) => part.type === 'month').value);
  const year = parts.find((part) => part.type === 'year').value;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function smsDunning({ business, domain, attempt, link }) {
  const n = String(attempt ?? '').replace(/\D/g, '').slice(0, 2) || '1';
  return pack(
    `TM: ${smsField(business, BUSINESS_MAX)} ${smsField(domain, DOMAIN_MAX)} pay failed ${n}/10. ${link}`,
  );
}

export function smsReminder({ business, domain, days, whenLabel, priceLabel, link }) {
  const n = String(days ?? '').replace(/\D/g, '').slice(0, 2);
  return pack(
    `TM: ${smsField(business, BUSINESS_MAX)} ${smsField(domain, DOMAIN_MAX)} renews in ${n}d ${smsField(whenLabel, 11)} ${smsPrice(priceLabel)}. ${link}`,
  );
}

export function smsPause({ business, domain, link }) {
  return pack(
    `TM: ${smsField(business, BUSINESS_MAX)} ${smsField(domain, DOMAIN_MAX)} paused. Pay ${link}`,
  );
}

export function smsResume({ business, domain, link }) {
  return pack(
    `TM: ${smsField(business, BUSINESS_MAX)} ${smsField(domain, DOMAIN_MAX)} resumed. ${link}`,
  );
}

export function worstCaseSms() {
  const fields = { business: WORST_BUSINESS, domain: WORST_DOMAIN, link: WORST_LINK };
  return [
    { id: 'dunning', body: smsDunning({ ...fields, attempt: 10 }) },
    {
      id: 'reminder',
      body: smsReminder({ ...fields, days: 30, whenLabel: WORST_WHEN, priceLabel: WORST_PRICE }),
    },
    { id: 'pause', body: smsPause(fields) },
    { id: 'resume', body: smsResume(fields) },
  ].map((row) => ({ ...row, length: row.body.length }));
}
