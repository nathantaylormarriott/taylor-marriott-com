import type { Config, Context } from "@netlify/functions";
import { json, readSession, unauthorized } from "./_shared/auth";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const session = await readSession(req, context);
  if (!session) return unauthorized();
  return json({ ok: true, username: session.u });
};

export const config: Config = {
  path: "/api/ops/session",
  method: "GET",
};
