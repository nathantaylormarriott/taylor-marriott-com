import type { Config } from "@netlify/functions";
import { isSamKeyError, SAM_KEY_REMINDER } from "./_shared/sam";
import { loadTenders, saveTenders } from "./_shared/store";
import { ingestRecentTenders, mergeTenders } from "./_shared/tenders";

export default async () => {
  try {
    const incoming = await ingestRecentTenders(24 * 24, { skipSam: true });
    const existing = await loadTenders();
    const { tenders, newCount } = mergeTenders(existing, incoming.tenders);
    await saveTenders(tenders, {
      lastNewCount: newCount,
      lastError: incoming.samKeyInvalid ? SAM_KEY_REMINDER : null,
      samKeyInvalid: incoming.samKeyInvalid,
    });
  } catch (error) {
    const samKeyInvalid = isSamKeyError(error);
    const message = samKeyInvalid
      ? SAM_KEY_REMINDER
      : error instanceof Error ? error.message : "Scheduled ingest failed";
    const existing = await loadTenders();
    await saveTenders(existing, { lastError: message, lastNewCount: 0, samKeyInvalid });
  }
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
