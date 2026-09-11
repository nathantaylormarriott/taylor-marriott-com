import type { Config, Context } from "@netlify/functions";
import { createSessionToken, json, sessionCookie, verifyLogin } from "./_shared/auth";

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await req.json().catch(() => ({})) as { username?: string; password?: string };
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const ok = await verifyLogin(username, password);
  if (!ok) return json({ error: "Invalid username or password." }, 401);
  const token = await createSessionToken(username);
  return json({ ok: true, username }, 200, { "Set-Cookie": sessionCookie(token) });
};

export const config: Config = {
  path: "/api/ops/login",
  method: "POST",
};
