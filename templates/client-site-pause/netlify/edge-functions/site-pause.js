/**
 * Drop-in edge function for bulk client sites (tmbulk-* / tm-preview-*).
 * Reads the per-site pause switch from Netlify Blobs on THIS site.
 * No rebuild. When the switch is off, the request continues unchanged (SEO unchanged).
 * When the switch is on, respond 503 with Retry-After and a paused page.
 *
 * netlify.toml on the client site:
 *   [[edge_functions]]
 *     function = "site-pause"
 *     path = "/*"
 */
import { getStore } from 'npm:@netlify/blobs';

export default async (request, context) => {
  let paused = false;
  try {
    const store = getStore({ name: 'site-pause', consistency: 'strong' });
    const record = await store.get('status', { type: 'json' });
    paused = Boolean(record && record.paused === true);
  } catch {
    paused = false;
  }
  if (!paused) return context.next();

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Paused | Taylor-Marriott</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f4ef; color: #121218; font-family: "Geist Sans", system-ui, sans-serif; font-weight: 300; }
    main { width: min(28rem, calc(100% - 2rem)); text-align: center; }
    img { width: 12rem; height: auto; margin-bottom: 1.5rem; }
    h1 { font-weight: 300; font-size: 1.6rem; letter-spacing: -0.03em; }
    p { line-height: 1.5; }
    .actions { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.25rem; }
    a { display: block; text-decoration: none; background: #121218; color: #f6f4ef; border-radius: 999px; padding: 0.8rem 1rem; letter-spacing: 0.06em; }
  </style>
</head>
<body>
  <main>
    <img src="https://taylor-marriott.com/brand/taylor-marriott-wordmark.png" alt="Taylor-Marriott" width="180" height="24">
    <h1>Contact Taylor-Marriott to resume your service</h1>
    <p>This site is paused until the subscription is paid.</p>
    <div class="actions">
      <a href="tel:+447831798112">Call 07831798112</a>
      <a href="https://wa.me/447831798112">WhatsApp</a>
      <a href="mailto:nathan@taylor-marriott.com">Email nathan@taylor-marriott.com</a>
    </div>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': '86400',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
};
