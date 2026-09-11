import type { Config, Context } from "@netlify/functions";
import { json, readSession, unauthorized } from "./_shared/auth";
import { SAM_ACCOUNT_URL } from "./_shared/sam";
import { loadMeta, loadTenders } from "./_shared/store";
import { isRelevantTender } from "./_shared/tenders";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const session = await readSession(req, context);
  if (!session) return unauthorized();

  const tenders = (await loadTenders()).filter(isRelevantTender);
  const meta = await loadMeta();

  return json({
    meta: {
      ...meta,
      total: tenders.length,
      samKeyHelpUrl: meta.samKeyInvalid ? SAM_ACCOUNT_URL : null,
    },
    count: tenders.length,
    tenders,
  });
};

export const config: Config = {
  path: "/api/ops/tenders",
  method: "GET",
};
