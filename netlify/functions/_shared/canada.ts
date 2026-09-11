import { classifyDigital } from "./classify";
import type { TenderRecord } from "./tenders";

const OPEN_CSV = "https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = (rows[0] || []).map((cell) => cell.trim());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key] = cells[index] || "";
    });
    return record;
  });
}

function col(row: Record<string, string>, key: string) {
  return (row[key] || "").trim();
}

export async function fetchCanadaBuys(): Promise<TenderRecord[]> {
  const response = await fetch(OPEN_CSV, {
    signal: AbortSignal.timeout(25000),
    headers: { Accept: "text/csv,text/plain", "User-Agent": "Taylor-Marriott-Ops/1.0" },
  });
  if (!response.ok) throw new Error(`CanadaBuys returned ${response.status}`);
  const records = parseCsv(await response.text());
  const out: TenderRecord[] = [];
  const seen = new Set<string>();

  for (const row of records) {
    const category = col(row, "procurementCategory-categorieApprovisionnement");
    if (category.includes("CNST") && !category.includes("SRV")) continue;
    const title = col(row, "title-titre-eng");
    const ref = col(row, "referenceNumber-numeroReference") || col(row, "solicitationNumber-numeroSollicitation");
    if (!title || !ref || seen.has(ref)) continue;
    seen.add(ref);

    const unspsc = col(row, "unspsc").split(/[;,]/)[0]?.trim() || "";
    const description = col(row, "tenderDescription-descriptionAppelOffres-eng");
    const classification = classifyDigital({
      source: "canada-buys",
      title,
      description,
      cpvId: unspsc,
      cpvDescription: col(row, "unspscDescription-eng") || col(row, "gsinDescription-nibsDescription-eng"),
    });
    const url = col(row, "noticeURL-URLavis-eng")
      || `https://canadabuys.canada.ca/en/tender-opportunities/${encodeURIComponent(ref)}`;

    const record: TenderRecord = {
      id: `canada-buys:${ref}`,
      ocid: ref,
      source: "canada-buys",
      title,
      description,
      buyer: col(row, "contractingEntityName-nomEntitContractante-eng") || "Government of Canada",
      value: null,
      valueHigh: null,
      currency: "CAD",
      publishedAt: col(row, "publicationDate-datePublication") || new Date().toISOString(),
      deadline: col(row, "tenderClosingDate-appelOffresDateCloture") || null,
      status: col(row, "tenderStatus-appelOffresStatut-eng") || col(row, "noticeType-avisType-eng") || "Open",
      region: col(row, "regionsOfDelivery-regionsLivraison-eng"),
      cpvId: unspsc,
      cpvDescription: col(row, "unspscDescription-eng"),
      url,
      classification,
      ingestedAt: new Date().toISOString(),
    };
    out.push(record);
    if (out.length >= 400) break;
  }

  return out;
}
