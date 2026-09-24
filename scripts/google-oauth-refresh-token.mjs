#!/usr/bin/env node
/**
 * One-time OAuth refresh token (Web or Desktop client).
 *
 * Web client: add this redirect URI in Google Cloud → Credentials → your OAuth client:
 *   http://localhost:3333/oauth/callback
 *
 * Usage (loads .env from project root if present):
 *   node scripts/google-oauth-refresh-token.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

function loadEnvFile() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const port = Number(process.env.OAUTH_LOCAL_PORT) || 3333;
const redirectUri = `http://localhost:${port}/oauth/callback`;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env');
  process.exit(1);
}

const scope = encodeURIComponent('https://www.googleapis.com/auth/calendar');
const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}` +
  '&access_type=offline&prompt=consent';

function upsertEnv(key, value) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  writeFileSync(envPath, content);
}

function openBrowser(url) {
  try {
    if (process.platform === 'darwin') execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    else if (process.platform === 'win32') execSync(`start ${JSON.stringify(url)}`, { stdio: 'ignore' });
    else execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: 'ignore' });
  } catch {
    console.log('Open this URL manually:\n', url);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  if (url.pathname !== '/oauth/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const err = url.searchParams.get('error');
  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<p>Google OAuth error: ${err}</p><p>You can close this tab.</p>`);
    console.error('OAuth error:', err, url.searchParams.get('error_description'));
    server.close();
    process.exit(1);
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p>Missing authorization code.</p>');
    return;
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await tokenRes.json();
  if (!tokenRes.ok || !data.refresh_token) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p>Token exchange failed. Check the terminal.</p>');
    console.error('Token exchange failed:', data);
    server.close();
    process.exit(1);
  }

  upsertEnv('GOOGLE_OAUTH_REFRESH_TOKEN', data.refresh_token);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    '<p><strong>Success.</strong> Refresh token saved to <code>.env</code>. You can close this tab.</p>',
  );

  console.log('\nSaved GOOGLE_OAUTH_REFRESH_TOKEN to .env\n');
  server.close();
  process.exit(0);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`\nListening on ${redirectUri}`);
  console.log('If Google shows redirect_uri_mismatch, add this URI to your OAuth Web client:\n');
  console.log(`  ${redirectUri}\n`);
  console.log('Opening browser for sign-in…\n');
  openBrowser(authUrl);
});

setTimeout(() => {
  console.error('\nTimed out waiting for OAuth callback (5 min).\n');
  server.close();
  process.exit(1);
}, 5 * 60 * 1000);
