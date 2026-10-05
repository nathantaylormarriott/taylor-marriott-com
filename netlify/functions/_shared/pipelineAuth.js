import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let localEnv;

function readLocalEnv() {
  if (localEnv) return localEnv;
  localEnv = {};
  try {
    const path = join(process.cwd(), '.env');
    if (!existsSync(path)) return localEnv;
    readFileSync(path, 'utf8').split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index < 1) return;
      localEnv[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    });
  } catch {
    localEnv = {};
  }
  return localEnv;
}

const COOKIE = 'pipeline_session';
const SESSION_SECONDS = 60 * 60 * 12;
const MAX_FAILURES = 8;
const LOCK_MS = 20 * 60 * 1000;

export function pipelineEnv(name) {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const value = globalThis.Netlify?.env?.get?.(name);
    if (typeof value === 'string' && value.length > 0) return value;
  } catch {
    /* runtime may not expose Netlify.env */
  }
  return readLocalEnv()[name] || '';
}

export function clientKey(request, context) {
  const ip = context?.ip
    || request.headers.get('x-nf-client-connection-ip')
    || 'unknown';
  return createHash('sha256')
    .update(`${pipelineEnv('PIPELINE_SESSION_SECRET')}:${ip}`)
    .digest('hex');
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  let expected;
  let actual;
  try {
    expected = Buffer.from(hashRaw, 'base64url');
    actual = scryptSync(String(password), Buffer.from(saltRaw, 'base64url'), expected.length, {
      N: Number(nRaw),
      r: Number(rRaw),
      p: Number(pRaw),
    });
  } catch {
    return false;
  }
  if (!expected.length || actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSession() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = randomBytes(16).toString('base64url');
  const body = `${exp}.${nonce}`;
  const sig = createHmac('sha256', pipelineEnv('PIPELINE_SESSION_SECRET')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSession(request) {
  const secret = pipelineEnv('PIPELINE_SESSION_SECRET');
  if (!secret) return false;
  const raw = request.headers.get('cookie') || '';
  const token = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expRaw, nonce, sig] = token.split('.');
  if (!expRaw || !nonce || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const body = `${expRaw}.${nonce}`;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${SESSION_SECONDS}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${COOKIE}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

export function hasPipelineHeader(request) {
  return request.headers.get('x-pipeline') === '1';
}

export { LOCK_MS, MAX_FAILURES };
