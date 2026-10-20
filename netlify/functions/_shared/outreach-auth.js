/**
 * Shared secret for enrol and status. Missing secret fails closed.
 */
import { timingSafeEqual } from 'node:crypto';
import { readEnv } from './billing-env.js';

export const ADMIN_HEADER = 'x-outreach-admin-secret';

export function outreachAuthorized(request, env) {
  const secret = String(readEnv('OUTREACH_ADMIN_SECRET', env) || '');
  if (!secret) {
    console.error('[outreach] OUTREACH_ADMIN_SECRET is missing. Rejecting (fail closed).');
    return false;
  }
  const header = String(request.headers.get(ADMIN_HEADER) || '');
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
