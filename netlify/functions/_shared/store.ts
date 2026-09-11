import { getStore } from "@netlify/blobs";
import type { TenderRecord } from "./tenders";

const INDEX_KEY = "index.json";
const META_KEY = "meta.json";
const SAM_CACHE_KEY = "sam-cache.json";
const SAM_CACHE_MS = 6 * 60 * 60 * 1000;

export type TenderMeta = {
  lastSyncAt: string | null;
  lastNewCount: number;
  lastError: string | null;
  samKeyInvalid: boolean;
  total: number;
  digitalCount: number;
};

function store() {
  return getStore({ name: "ops-tenders", consistency: "strong" });
}

export async function loadTenders(): Promise<TenderRecord[]> {
  const data = await store().get(INDEX_KEY, { type: "json" });
  return Array.isArray(data) ? data as TenderRecord[] : [];
}

export async function saveTenders(tenders: TenderRecord[], extra: Partial<TenderMeta> = {}) {
  const blobs = store();
  await blobs.setJSON(INDEX_KEY, tenders);
  const meta: TenderMeta = {
    lastSyncAt: extra.lastSyncAt ?? new Date().toISOString(),
    lastNewCount: extra.lastNewCount ?? 0,
    lastError: extra.lastError ?? null,
    samKeyInvalid: extra.samKeyInvalid ?? false,
    total: tenders.length,
    digitalCount: tenders.filter((row) => row.classification.digital).length,
  };
  await blobs.setJSON(META_KEY, meta);
  return meta;
}

export async function loadMeta(): Promise<TenderMeta> {
  const data = await store().get(META_KEY, { type: "json" });
  return {
    lastSyncAt: data?.lastSyncAt ?? null,
    lastNewCount: data?.lastNewCount ?? 0,
    lastError: data?.lastError ?? null,
    samKeyInvalid: Boolean(data?.samKeyInvalid),
    total: data?.total ?? 0,
    digitalCount: data?.digitalCount ?? 0,
  };
}

type SamCache = {
  fetchedAt: string;
  tenders: TenderRecord[];
};

export async function loadSamCache(maxAgeMs = SAM_CACHE_MS): Promise<TenderRecord[] | null> {
  const data = await store().get(SAM_CACHE_KEY, { type: "json" }) as SamCache | null;
  if (!data?.fetchedAt || !Array.isArray(data.tenders)) return null;
  if (Date.now() - Date.parse(data.fetchedAt) > maxAgeMs) return null;
  return data.tenders;
}

export async function saveSamCache(tenders: TenderRecord[]) {
  await store().setJSON(SAM_CACHE_KEY, {
    fetchedAt: new Date().toISOString(),
    tenders,
  });
}

export async function loadSamCacheStale(): Promise<TenderRecord[]> {
  const data = await store().get(SAM_CACHE_KEY, { type: "json" }) as SamCache | null;
  return Array.isArray(data?.tenders) ? data.tenders : [];
}
