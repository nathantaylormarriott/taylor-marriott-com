const buckets = new Map();

/**
 * Simple in-memory rate limit (best-effort on serverless).
 * @returns {{ allowed: boolean, retryAfterSec?: number }}
 */
export function rateLimit(key, { limit = 20, windowMs = 60_000, now = Date.now() } = {}) {
  let entry = buckets.get(key);
  if (!entry || now - entry.start >= windowMs) {
    entry = { start: now, count: 0 };
    buckets.set(key, entry);
  }
  if (entry.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  entry.count += 1;
  return { allowed: true };
}

export function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for') || '';
  const first = xff.split(',')[0]?.trim();
  return first || request.headers.get('client-ip') || request.headers.get('x-nf-client-connection-ip') || 'unknown';
}
