import type { Context } from "@netlify/functions";

const COOKIE = "ops_session";
const DAY_MS = 1000 * 60 * 60 * 24 * 7;

function env(name: string, fallback = "") {
  return Netlify.env.get(name) || process.env[name] || fallback;
}

export function opsCredentials() {
  return {
    username: env("OPS_USERNAME"),
    password: env("OPS_PASSWORD"),
    secret: env("OPS_SESSION_SECRET"),
  };
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function createSessionToken(username: string) {
  const { secret } = opsCredentials();
  if (!secret) throw new Error("OPS_SESSION_SECRET is not set");
  const payload = toBase64Url(JSON.stringify({
    u: username,
    exp: Date.now() + DAY_MS,
  }));
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function readSession(req: Request, context: Context) {
  const { secret, username } = opsCredentials();
  if (!secret) return null;
  const token = context.cookies.get(COOKIE) || cookieFromHeader(req, COOKIE);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const data = JSON.parse(fromBase64Url(payload)) as { u?: string; exp?: number };
    if (!data.exp || data.exp < Date.now()) return null;
    if (data.u !== username) return null;
    return data;
  } catch {
    return null;
  }
}

function cookieFromHeader(req: Request, name: string) {
  const raw = req.headers.get("cookie") || "";
  const match = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function verifyLogin(username: string, password: string) {
  const creds = opsCredentials();
  if (!creds.username || !creds.password) return false;
  return timingSafeEqual(username, creds.username) && timingSafeEqual(password, creds.password);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}
