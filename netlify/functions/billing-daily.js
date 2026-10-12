import { readEnv } from './_shared/billing-env.js';

/** Daily tick. Starts the background run so the 30s schedule limit is not the worker. */
export default async () => {
  const base = readEnv('URL') || '';
  const secret = readEnv('BILLING_CRON_SECRET');
  if (base) {
    try {
      await fetch(`${base}/api/billing-daily`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: '{}',
      });
    } catch (err) {
      console.error('[billing-daily] kick failed', err.message);
    }
  }
  return new Response(JSON.stringify({ ok: true, kicked: Boolean(base) }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '0 7 * * *',
};
