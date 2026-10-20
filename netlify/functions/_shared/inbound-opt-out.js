/**
 * Opt-out detection for inbound SMS and WhatsApp.
 * A message counts only when it is mainly an opt-out phrase.
 * "stop by tomorrow?" stays a normal reply.
 */

const FILLER = new Set([
  'please',
  'thanks',
  'thank',
  'you',
  'me',
  'my',
  'now',
  'the',
  'a',
  'an',
  'from',
  'your',
  'list',
  'off',
  'this',
  'ok',
  'okay',
  'all',
  'just',
  'hey',
  'hi',
  'hello',
  'to',
  'of',
  'and',
  'i',
  'im',
  'am',
  'we',
  'us',
  'our',
  'so',
  'very',
  'really',
  'would',
  'like',
  'oh',
  'pls',
  'plz',
  'no',
]);

const KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];

const PHRASES = [
  'stop texting',
  'stop messaging',
  'stop messages',
  'stop all',
  'not interested',
  'remove me',
  'opt out',
  'take me off',
  'leave me alone',
  'do not contact',
  'do not text',
  'do not message',
  'dont contact',
  'dont text',
  'dont message',
  'no more texts',
  'no more text',
  'no more messages',
  'no more sms',
];

const TRAILING = new Set([
  'about',
  'regarding',
  'in',
  'on',
  'for',
  'your',
  'my',
  'the',
  'this',
  'that',
  'a',
  'website',
  'site',
  'service',
  'services',
  'messages',
  'message',
  'texts',
  'text',
  'texting',
  'sms',
  'whatsapp',
  'number',
  'list',
  'me',
  'you',
  'anymore',
  'again',
  'please',
  'it',
  'them',
  'us',
  'by',
  'tomorrow',
  'today',
  'later',
]);

export function normalizeOptOutText(body) {
  return String(body || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function spanAt(words, start, phraseWords) {
  if (start + phraseWords.length > words.length) return false;
  return phraseWords.every((word, index) => words[start + index] === word);
}

function outsideAllowed(words, start, length, allowTrailing) {
  for (let index = 0; index < words.length; index += 1) {
    if (index >= start && index < start + length) continue;
    const word = words[index];
    if (FILLER.has(word)) continue;
    if (allowTrailing && TRAILING.has(word)) continue;
    return false;
  }
  return true;
}

export function isOptOut(body) {
  const normalized = normalizeOptOutText(body);
  if (!normalized) return false;
  const words = normalized.split(' ');
  if (KEYWORDS.includes(normalized) || PHRASES.includes(normalized)) return true;

  const phrases = [...PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const phraseWords = phrase.split(' ');
    for (let start = 0; start <= words.length - phraseWords.length; start += 1) {
      if (!spanAt(words, start, phraseWords)) continue;
      if (outsideAllowed(words, start, phraseWords.length, true)) return true;
    }
  }

  for (const keyword of KEYWORDS) {
    for (let start = 0; start < words.length; start += 1) {
      if (words[start] !== keyword) continue;
      if (outsideAllowed(words, start, 1, false)) return true;
    }
  }
  return false;
}
