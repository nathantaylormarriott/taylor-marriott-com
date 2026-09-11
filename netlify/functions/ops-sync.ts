import type { Config, Context } from "@netlify/functions";
import { json, readSession, unauthorized } from "./_shared/auth";
import { loadTenders, saveTenders } from "./_shared/store";
import { isSamKeyError, SAM_ACCOUNT_URL, SAM_KEY_REMINDER } from "./_shared/sam";
import { ingestRecentTenders, mergeTenders } from "./_shared/tenders";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const session = await readSession(req, context);
  if (!session) return unauthorized();

  try {
    const incoming = await ingestRecentTenders(14 * 24);
    const existing = await loadTenders();
    const { tenders, newCount } = mergeTenders(existing, incoming.tenders);
    const samKeyInvalid = incoming.samKeyInvalid;
    const samWarning = incoming.errors.find((item) => /SAM/i.test(item)) || null;
    const meta = await saveTenders(tenders, {
      lastNewCount: newCount,
      lastError: samKeyInvalid ? SAM_KEY_REMINDER : samWarning,
      samKeyInvalid,
    });
    return json({
      ok: true,
      meta,
      fetched: incoming.tenders.length,
      newCount,
      samKeyInvalid,
      samKeyHelpUrl: samKeyInvalid ? SAM_ACCOUNT_URL : null,
      error: samKeyInvalid ? SAM_KEY_REMINDER : null,
    });
  } catch (error) {
    const samKeyInvalid = isSamKeyError(error);
    const message = samKeyInvalid
      ? SAM_KEY_REMINDER
      : error instanceof Error ? error.message : "Sync failed";
    const existing = await loadTenders();
    const meta = await saveTenders(existing, {
      lastError: message,
      lastNewCount: 0,
      samKeyInvalid,
    });
    return json({
      error: message,
      samKeyInvalid,
      samKeyHelpUrl: samKeyInvalid ? SAM_ACCOUNT_URL : null,
      meta,
    }, samKeyInvalid ? 200 : 502);
  }
};

export const config: Config = {
  path: "/api/ops/sync",
  method: "POST",
};
