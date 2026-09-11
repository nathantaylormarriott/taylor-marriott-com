import { classifyDigital, type Classification } from "./classify";

import { fetchCanadaBuys } from "./canada";
import { SamKeyError, SAM_RATE_LIMIT } from "./sam";
import { loadSamCache, loadSamCacheStale, saveSamCache } from "./store";

export type TenderRecord = {
  id: string;
  ocid: string;
  source: "contracts-finder" | "find-a-tender" | "sell2wales" | "public-contracts-scotland" | "sam-gov" | "canada-buys";
  title: string;
  description: string;
  buyer: string;
  value: number | null;
  valueHigh: number | null;
  currency: string;
  publishedAt: string;
  deadline: string | null;
  status: string;
  region: string;
  cpvId: string;
  cpvDescription: string;
  url: string;
  classification: Classification;
  ingestedAt: string;
  setAside?: string;
};

type OcdsRelease = {
  id?: string;
  ocid?: string;
  date?: string;
  tag?: string[];
  tender?: {
    title?: string;
    description?: string;
    status?: string;
    classification?: { id?: string; description?: string };
    value?: { amount?: number; currency?: string };
    tenderPeriod?: { endDate?: string };
  };
  parties?: Array<{ name?: string; roles?: string[] }>;
  buyer?: { name?: string };
};

type OcdsPackage = {
  releases?: OcdsRelease[];
};

const CF_SEARCH_URL = "https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json";
const FTS_URL = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages";
const SELL2WALES_URL = "https://api.sell2wales.gov.wales/v1/Notices";
const PCS_URL = "https://api.publiccontractsscotland.gov.uk/v1/Notices";
const VALUE_CAP = 1_000_000;
const KEYWORDS = [
  "website",
  "web design",
  "software development",
  "digital product",
  "digital marketing",
  "graphic design",
  "branding",
  "mobile app",
  "artificial intelligence",
  "ux design",
  "portal",
  "intranet",
];

function isoNoMs(date: Date) {
  return date.toISOString().slice(0, 19);
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function deadlineTime(deadline: string | null) {
  if (!deadline) return Number.NaN;
  const trimmed = deadline.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return Date.UTC(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      23,
      59,
      59,
      999,
    );
  }
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? time : Number.NaN;
}

export function hasOpenDeadline(deadline: string | null) {
  const time = deadlineTime(deadline);
  return Number.isFinite(time) && time >= Date.now();
}

export function withinValueCap(row: TenderRecord) {
  const high = row.valueHigh ?? row.value;
  if (high == null || high === 0) return true;
  return high <= VALUE_CAP;
}

export function isRelevantTender(row: TenderRecord) {
  return row.classification.digital && hasOpenDeadline(row.deadline) && withinValueCap(row);
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      Accept: "application/json",
      "User-Agent": "Taylor-Marriott-Ops/1.0 (hello@taylor-marriott.com)",
    },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json() as Promise<OcdsPackage>;
}

function noticeUrl(source: TenderRecord["source"], release: OcdsRelease) {
  const ocid = release.ocid || "";
  const ref = String(release.id || "").split("-").pop() || "";
  if (source === "find-a-tender") {
    return `https://www.find-tender.service.gov.uk/Notice/${encodeURIComponent(release.id || "")}`;
  }
  if (source === "sell2wales") {
    return ref
      ? `https://www.sell2wales.gov.wales/search/show/search_view.aspx?ID=${encodeURIComponent(ref)}`
      : `https://www.sell2wales.gov.wales/search/search_mainpage.aspx?ocid=${encodeURIComponent(ocid)}`;
  }
  if (source === "public-contracts-scotland") {
    return ref
      ? `https://www.publiccontractsscotland.gov.uk/search/show/search_view.aspx?ID=${encodeURIComponent(ref)}`
      : `https://www.publiccontractsscotland.gov.uk/search/search_mainpage.aspx`;
  }
  return `https://www.contractsfinder.service.gov.uk/Notice/${encodeURIComponent(release.id || "")}`;
}

function toRecord(source: TenderRecord["source"], release: OcdsRelease): TenderRecord | null {
  const tender = release.tender;
  if (!tender?.title || !release.ocid) return null;
  const buyer =
    release.buyer?.name ||
    release.parties?.find((party) => party.roles?.includes("buyer"))?.name ||
    "Unknown buyer";
  const description = tender.description || "";
  const classification = classifyDigital({
    source,
    title: tender.title,
    description,
    cpvId: tender.classification?.id,
    cpvDescription: tender.classification?.description,
  });

  return {
    id: `${source}:${release.ocid}:${release.id || "unknown"}`,
    ocid: release.ocid,
    source,
    title: tender.title,
    description,
    buyer,
    value: typeof tender.value?.amount === "number" ? tender.value.amount : null,
    valueHigh: null,
    currency: tender.value?.currency || "GBP",
    publishedAt: release.date || new Date().toISOString(),
    deadline: tender.tenderPeriod?.endDate || null,
    status: tender.status || (release.tag || []).join(", ") || "tender",
    region: "",
    cpvId: tender.classification?.id || "",
    cpvDescription: tender.classification?.description || "",
    url: noticeUrl(source, release),
    classification,
    ingestedAt: new Date().toISOString(),
  };
}

async function fetchSource(since: Date): Promise<TenderRecord[]> {
  const from = isoNoMs(since);
  const to = isoNoMs(new Date());
  const url = `${FTS_URL}?updatedFrom=${encodeURIComponent(from)}&updatedTo=${encodeURIComponent(to)}&stages=tender&limit=100`;
  const pack = await fetchJson(url);
  return (pack.releases || [])
    .map((release) => toRecord("find-a-tender", release))
    .filter((row): row is TenderRecord => Boolean(row));
}

function monthKeys(count = 2) {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    keys.push(`${month}-${date.getUTCFullYear()}`);
  }
  return keys;
}

async function fetchDevolvedNotices(): Promise<TenderRecord[]> {
  const months = monthKeys(2);
  const jobs: Array<{ source: TenderRecord["source"]; url: string }> = [];

  for (const month of months) {
    for (const noticeType of [2, 51]) {
      jobs.push({
        source: "sell2wales",
        url: `${SELL2WALES_URL}?dateFrom=${month}&noticeType=${noticeType}&outputType=0&locale=2057`,
      });
    }
    for (const noticeType of [2, 102]) {
      jobs.push({
        source: "public-contracts-scotland",
        url: `${PCS_URL}?dateFrom=${month}&noticeType=${noticeType}&outputType=0`,
      });
    }
  }

  const batches = await Promise.all(jobs.map(async ({ source, url }) => {
    try {
      const pack = await fetchJson(url);
      return (pack.releases || [])
        .map((release) => toRecord(source, release))
        .filter((row): row is TenderRecord => Boolean(row));
    } catch {
      return [] as TenderRecord[];
    }
  }));

  return batches.flat();
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&nbsp;/g, " ")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type SearchHit = {
  item?: {
    id?: string;
    title?: string;
    description?: string;
    organisationName?: string;
    publishedDate?: string;
    deadlineDate?: string;
    cpvCodes?: string;
    cpvDescription?: string;
    valueLow?: number;
    valueHigh?: number;
    noticeStatus?: string;
    regionText?: string;
  };
};

async function fetchKeywordNotices(): Promise<TenderRecord[]> {
  const batches = await Promise.all(KEYWORDS.map(async (keyword) => {
    const response = await fetch(CF_SEARCH_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Taylor-Marriott-Ops/1.0 (hello@taylor-marriott.com)",
      },
      body: JSON.stringify({
        searchCriteria: {
          keyword,
          statuses: ["Open"],
          deadlineFrom: isoNoMs(new Date()),
          valueFrom: 0,
          valueTo: VALUE_CAP,
        },
        size: 100,
      }),
    });
    if (!response.ok) return [] as TenderRecord[];
    const pack = await response.json() as { noticeList?: SearchHit[] };
    const rows: TenderRecord[] = [];
    for (const hit of pack.noticeList || []) {
      const item = hit.item;
      if (!item?.id || !item.title) continue;
      const title = decodeEntities(item.title);
      const description = decodeEntities(item.description || "");
      const cpvId = (item.cpvCodes || "").split(/\s+/)[0] || "";
      const classification = classifyDigital({
        source: "contracts-finder",
        title,
        description,
        cpvId,
        cpvDescription: item.cpvDescription,
      });
      rows.push({
        id: `contracts-finder:${item.id}`,
        ocid: item.id,
        source: "contracts-finder",
        title,
        description,
        buyer: item.organisationName || "Unknown buyer",
        value: typeof item.valueLow === "number" ? item.valueLow : null,
        valueHigh: typeof item.valueHigh === "number" ? item.valueHigh : null,
        currency: "GBP",
        publishedAt: item.publishedDate || new Date().toISOString(),
        deadline: item.deadlineDate || null,
        status: item.noticeStatus || "Open",
        region: item.regionText || "",
        cpvId,
        cpvDescription: item.cpvDescription || "",
        url: `https://www.contractsfinder.service.gov.uk/Notice/${item.id}`,
        classification,
        ingestedAt: new Date().toISOString(),
      });
    }
    return rows;
  }));

  return batches.flat();
}

function env(name: string) {
  return (typeof Netlify !== "undefined" ? Netlify.env.get(name) : "") || process.env[name] || "";
}

function mmddyyyy(date: Date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const amount = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

type SamOpportunity = {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  postedDate?: string;
  type?: string;
  typeOfSetAsideDescription?: string | null;
  typeOfSetAside?: string | null;
  responseDeadLine?: string | null;
  naicsCode?: string | null;
  classificationCode?: string | null;
  description?: string | null;
  award?: { amount?: string | number };
  placeOfPerformance?: {
    state?: { name?: string; code?: string };
    city?: { name?: string };
  };
};

function samToRecord(opp: SamOpportunity, description: string): TenderRecord | null {
  if (!opp.noticeId || !opp.title) return null;
  const naics = opp.naicsCode || "";
  const classification = classifyDigital({
    source: "sam-gov",
    title: opp.title,
    description,
    cpvId: naics,
  });
  const amount = parseAmount(opp.award?.amount);
  const region = [
    opp.placeOfPerformance?.city?.name,
    opp.placeOfPerformance?.state?.code || opp.placeOfPerformance?.state?.name,
  ].filter(Boolean).join(", ");

  return {
    id: `sam-gov:${opp.noticeId}`,
    ocid: opp.solicitationNumber || opp.noticeId,
    source: "sam-gov",
    title: opp.title.trim(),
    description,
    buyer: (opp.fullParentPathName || "US federal").split(".")[0] || "US federal",
    value: amount,
    valueHigh: amount,
    currency: "USD",
    publishedAt: opp.postedDate || new Date().toISOString(),
    deadline: opp.responseDeadLine || null,
    status: opp.type || "Solicitation",
    region,
    cpvId: naics,
    cpvDescription: naics ? `NAICS ${naics}` : "",
    url: `https://sam.gov/opp/${encodeURIComponent(opp.noticeId)}/view`,
    classification,
    ingestedAt: new Date().toISOString(),
    setAside: opp.typeOfSetAsideDescription || opp.typeOfSetAside || "",
  };
}

async function fetchSamNotices(): Promise<TenderRecord[]> {
  const apiKey = env("SAM_API_KEY").trim();
  if (!apiKey) throw new SamKeyError();

  const fresh = await loadSamCache();
  if (fresh?.length) return fresh;

  const postedTo = new Date();
  const postedFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: mmddyyyy(postedFrom),
    postedTo: mmddyyyy(postedTo),
    ptype: "o",
    ncode: "541511",
    limit: "50",
    offset: "0",
  });
  const url = `https://api.sam.gov/opportunities/v2/search?${params}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(35000),
      headers: { Accept: "application/json", "User-Agent": "Taylor-Marriott-Ops/1.0" },
    });
    if (response.status === 401 || response.status === 403) throw new SamKeyError();
    if (response.status === 429) {
      const stale = await loadSamCacheStale();
      if (stale.length) return stale;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        continue;
      }
      throw new Error(SAM_RATE_LIMIT);
    }
    if (!response.ok) throw new Error(SAM_RATE_LIMIT);
    const pack = await response.json() as { opportunitiesData?: SamOpportunity[] };
    const rows = (pack.opportunitiesData || [])
      .map((opp) => samToRecord(opp, opp.description && !opp.description.startsWith("http") ? opp.description : ""))
      .filter((row): row is TenderRecord => Boolean(row));
    await saveSamCache(rows);
    return rows;
  }

  const stale = await loadSamCacheStale();
  if (stale.length) return stale;
  throw new Error(SAM_RATE_LIMIT);
}


export type IngestResult = {
  tenders: TenderRecord[];
  samKeyInvalid: boolean;
  errors: string[];
};

export async function ingestRecentTenders(lookbackHours = 36, opts: { skipSam?: boolean } = {}): Promise<IngestResult> {
  const since = hoursAgo(lookbackHours);
  const jobs: Array<Promise<TenderRecord[]>> = [
    fetchSource(since),
    fetchKeywordNotices(),
    fetchDevolvedNotices(),
    fetchCanadaBuys(),
  ];
  if (!opts.skipSam) jobs.push(fetchSamNotices());
  const results = await Promise.allSettled(jobs);

  const rows: TenderRecord[] = [];
  const errors: string[] = [];
  let samKeyInvalid = false;
  for (const result of results) {
    if (result.status === "fulfilled") {
      rows.push(...result.value);
      continue;
    }
    const reason = result.reason;
    if (reason instanceof SamKeyError) samKeyInvalid = true;
    errors.push(reason instanceof Error ? reason.message : String(reason));
  }
  if (!rows.length && errors.length && !samKeyInvalid) {
    throw new Error(errors.join("; "));
  }
  if (!rows.length && samKeyInvalid && errors.length === 1) {
    throw new SamKeyError();
  }
  return {
    tenders: rows.filter(isRelevantTender),
    samKeyInvalid,
    errors,
  };
}

export function mergeTenders(existing: TenderRecord[], incoming: TenderRecord[], max = 500) {
  const map = new Map<string, TenderRecord>();
  for (const row of existing) {
    if (isRelevantTender(row)) map.set(row.id, row);
  }
  const freshIds: string[] = [];
  for (const row of incoming) {
    if (!isRelevantTender(row)) continue;
    if (!map.has(row.id)) freshIds.push(row.id);
    map.set(row.id, row);
  }
  const merged = [...map.values()].sort((a, b) => {
    const byDeadline = deadlineTime(a.deadline) - deadlineTime(b.deadline);
    if (byDeadline !== 0) return byDeadline;
    return (b.classification.score || 0) - (a.classification.score || 0);
  });
  return {
    tenders: merged.slice(0, max),
    newCount: freshIds.length,
  };
}
