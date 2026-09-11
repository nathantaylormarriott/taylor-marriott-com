import type { Config } from "@netlify/functions";
import { clearSessionCookie, json } from "./_shared/auth";

export default async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
};

export const config: Config = {
  path: "/api/ops/logout",
  method: "POST",
};
