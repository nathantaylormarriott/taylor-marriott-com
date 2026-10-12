/**
 * One-segment SMS: GSM-7 only, 159 septets.
 * Extension-table characters (for example €) count as 2. Emoji, curly quotes
 * and em dashes are not GSM-7 and are refused.
 */

const GSM7_BASIC = new Set(
  Array.from(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ),
);

const GSM7_EXT = new Set(Array.from('^{}\\[~]|€\f'));

const FOLDS = [
  ['\u2014', '-'],
  ['\u2013', '-'],
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201C', '"'],
  ['\u201D', '"'],
  ['\u00A0', ' '],
  ['\u2026', '...'],
];

export const SMS_SEPTET_LIMIT = 159;

export function gsmSeptetLength(text) {
  let n = 0;
  for (const ch of String(text ?? '')) {
    if (GSM7_BASIC.has(ch)) n += 1;
    else if (GSM7_EXT.has(ch)) n += 2;
    else return null;
  }
  return n;
}

export function assertSmsBody(body) {
  const text = String(body ?? '');
  const septets = gsmSeptetLength(text);
  if (septets == null) {
    const err = new Error('SMS is not GSM-7. Not sent.');
    err.code = 'SMS_NOT_GSM7';
    throw err;
  }
  if (septets > SMS_SEPTET_LIMIT) {
    const err = new Error(`SMS is ${septets} septets. Limit is ${SMS_SEPTET_LIMIT}. Not sent.`);
    err.code = 'SMS_TOO_LONG';
    throw err;
  }
  return text;
}

/** Fold common punctuation, then drop anything that is not basic GSM-7. */
export function toGsm(value) {
  let text = String(value ?? '');
  for (const [from, to] of FOLDS) text = text.split(from).join(to);
  let out = '';
  for (const ch of text) if (GSM7_BASIC.has(ch)) out += ch;
  return out.replace(/[ \t]+/g, ' ').trim();
}

export function smsField(value, max) {
  return toGsm(value).slice(0, max).trim();
}
