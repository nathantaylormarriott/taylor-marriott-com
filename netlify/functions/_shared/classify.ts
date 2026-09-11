export type MatchSource =
  | "contracts-finder"
  | "find-a-tender"
  | "sell2wales"
  | "public-contracts-scotland"
  | "sam-gov"
  | "canada-buys";

export type Classification = {
  digital: boolean;
  score: number;
  reasons: string[];
  lanes: string[];
};

type Lane = "product" | "web" | "design" | "marketing" | "ai";

type Signal = {
  phrase: string;
  weight: number;
  lane: Lane;
};

type CodeMap = Array<{ prefix: string; lane: Lane; label: string; weight: number }>;

type Profile = {
  bodyWeight: number;
  minScore: number;
  minLanguage: number;
  extraSignals: Signal[];
  extraTitleVetoes: string[];
  codes: CodeMap;
  codeVetoPrefixes: string[];
  codeAlone: boolean;
};

const CORE_SIGNALS: Signal[] = [
  { phrase: "website", weight: 6, lane: "web" },
  { phrase: "web site", weight: 6, lane: "web" },
  { phrase: "web design", weight: 7, lane: "web" },
  { phrase: "web development", weight: 7, lane: "web" },
  { phrase: "web application", weight: 7, lane: "web" },
  { phrase: "web app", weight: 7, lane: "web" },
  { phrase: "web platform", weight: 6, lane: "web" },
  { phrase: "microsite", weight: 6, lane: "web" },
  { phrase: "intranet", weight: 6, lane: "web" },
  { phrase: "extranet", weight: 5, lane: "web" },
  { phrase: "digital product", weight: 8, lane: "product" },
  { phrase: "digital platform", weight: 7, lane: "product" },
  { phrase: "digital service", weight: 5, lane: "product" },
  { phrase: "software development", weight: 8, lane: "product" },
  { phrase: "custom software", weight: 8, lane: "product" },
  { phrase: "application development", weight: 7, lane: "product" },
  { phrase: "product development", weight: 4, lane: "product" },
  { phrase: "mobile app", weight: 7, lane: "product" },
  { phrase: "ios app", weight: 7, lane: "product" },
  { phrase: "android app", weight: 7, lane: "product" },
  { phrase: "app development", weight: 7, lane: "product" },
  { phrase: "saas", weight: 6, lane: "product" },
  { phrase: "mvp", weight: 5, lane: "product" },
  { phrase: "prototype", weight: 4, lane: "product" },
  { phrase: "user experience", weight: 6, lane: "design" },
  { phrase: "user interface", weight: 6, lane: "design" },
  { phrase: "ux/ui", weight: 6, lane: "design" },
  { phrase: "ui/ux", weight: 6, lane: "design" },
  { phrase: "ux design", weight: 7, lane: "design" },
  { phrase: "ui design", weight: 6, lane: "design" },
  { phrase: "product design", weight: 7, lane: "design" },
  { phrase: "service design", weight: 5, lane: "design" },
  { phrase: "graphic design", weight: 7, lane: "design" },
  { phrase: "brand identity", weight: 7, lane: "design" },
  { phrase: "visual identity", weight: 6, lane: "design" },
  { phrase: "branding", weight: 6, lane: "design" },
  { phrase: "content design", weight: 5, lane: "design" },
  { phrase: "digital marketing", weight: 7, lane: "marketing" },
  { phrase: "social media", weight: 5, lane: "marketing" },
  { phrase: "creative campaign", weight: 5, lane: "marketing" },
  { phrase: "artificial intelligence", weight: 6, lane: "ai" },
  { phrase: "machine learning", weight: 6, lane: "ai" },
  { phrase: "generative ai", weight: 7, lane: "ai" },
  { phrase: "e-commerce", weight: 6, lane: "web" },
  { phrase: "ecommerce", weight: 6, lane: "web" },
  { phrase: "wordpress", weight: 6, lane: "web" },
  { phrase: "drupal", weight: 5, lane: "web" },
  { phrase: "cms", weight: 5, lane: "web" },
  { phrase: "content management", weight: 5, lane: "web" },
  { phrase: "customer portal", weight: 6, lane: "web" },
  { phrase: "client portal", weight: 6, lane: "web" },
  { phrase: "online portal", weight: 6, lane: "web" },
  { phrase: "online platform", weight: 5, lane: "product" },
];

const BODY_ONLY: Signal[] = [
  { phrase: "front-end", weight: 3, lane: "web" },
  { phrase: "frontend", weight: 3, lane: "web" },
  { phrase: "react", weight: 3, lane: "product" },
  { phrase: "next.js", weight: 3, lane: "product" },
  { phrase: "product discovery", weight: 3, lane: "product" },
  { phrase: "design system", weight: 4, lane: "design" },
  { phrase: "brand guidelines", weight: 4, lane: "design" },
  { phrase: "paid social", weight: 3, lane: "marketing" },
  { phrase: "llm", weight: 3, lane: "ai" },
];

const TITLE_VETO = [
  "toilet",
  "restroom",
  "janitorial",
  "catering",
  "food service",
  "snow removal",
  "landscaping",
  "pest control",
  "asphalt",
  "highway",
  "roofing",
  "fencing",
  "hvac",
  "plumbing",
  "civil works",
  "civil engineering",
  "construction of",
  "building works",
  "ammunition",
  "weapon",
  "pharmaceutical",
  "medical device",
  "waste collection",
  "refuse",
  "uniform",
  "vehicle maintenance",
  "fleet maintenance",
  "preventive maintenance",
  "portable toilet",
  "handwash",
  "locker rm",
];

const BODY_VETO = [
  "demolition",
  "excavation",
  "concrete pour",
  "clinical trial drug",
  "munition",
];

const NAICS_CODES: CodeMap = [
  { prefix: "541511", lane: "product", label: "Custom programming", weight: 5 },
  { prefix: "541512", lane: "product", label: "Systems design", weight: 4 },
  { prefix: "541430", lane: "design", label: "Graphic design", weight: 5 },
  { prefix: "541490", lane: "design", label: "Specialized design", weight: 3 },
  { prefix: "541810", lane: "marketing", label: "Advertising", weight: 5 },
  { prefix: "541613", lane: "marketing", label: "Marketing consulting", weight: 4 },
  { prefix: "541910", lane: "marketing", label: "Market research", weight: 3 },
  { prefix: "511210", lane: "product", label: "Software publishers", weight: 4 },
  { prefix: "518210", lane: "product", label: "Data processing", weight: 2 },
];

const CPV_CODES: CodeMap = [
  { prefix: "7241", lane: "web", label: "Web services", weight: 6 },
  { prefix: "7240", lane: "web", label: "Internet services", weight: 4 },
  { prefix: "7221", lane: "product", label: "Software programming", weight: 6 },
  { prefix: "7223", lane: "product", label: "Software development", weight: 5 },
  { prefix: "7226", lane: "product", label: "Software-related services", weight: 4 },
  { prefix: "48000000", lane: "product", label: "Software packages", weight: 4 },
  { prefix: "79341000", lane: "marketing", label: "Advertising", weight: 5 },
  { prefix: "79340000", lane: "marketing", label: "Advertising", weight: 4 },
  { prefix: "79413000", lane: "marketing", label: "Marketing", weight: 5 },
  { prefix: "79822500", lane: "design", label: "Graphic design", weight: 5 },
  { prefix: "79821000", lane: "design", label: "Print/design", weight: 3 },
];

const UK_CPV_VETO = ["45", "34", "33", "15", "60", "90", "44", "14"];
const SAM_NAICS_VETO = ["23", "56", "72", "62", "21", "22", "48", "49"];
const UNSPSC_VETO = ["72", "30", "31", "32", "25", "46", "50", "12"];

const UNSPSC_CODES: CodeMap = [
  { prefix: "4323", lane: "product", label: "Software", weight: 6 },
  { prefix: "432315", lane: "product", label: "Software", weight: 6 },
  { prefix: "8111", lane: "product", label: "Computer services", weight: 5 },
  { prefix: "811117", lane: "product", label: "Programming", weight: 6 },
  { prefix: "811118", lane: "product", label: "Systems services", weight: 5 },
  { prefix: "8014", lane: "marketing", label: "Advertising", weight: 5 },
  { prefix: "821215", lane: "design", label: "Graphic design", weight: 6 },
  { prefix: "8210", lane: "design", label: "Print/graphic", weight: 3 },
];

const UK_EXTRA: Signal[] = [
  { phrase: "digital outcomes", weight: 7, lane: "product" },
  { phrase: "digital marketplace", weight: 5, lane: "product" },
  { phrase: "gds", weight: 4, lane: "web" },
  { phrase: "gov.uk", weight: 4, lane: "web" },
  { phrase: "crown commercial", weight: 3, lane: "product" },
  { phrase: "discovery phase", weight: 4, lane: "product" },
  { phrase: "alpha phase", weight: 4, lane: "product" },
  { phrase: "beta phase", weight: 4, lane: "product" },
  { phrase: "user research", weight: 5, lane: "design" },
];

const SAM_EXTRA: Signal[] = [
  { phrase: "information technology", weight: 4, lane: "product" },
  { phrase: "it services", weight: 4, lane: "product" },
  { phrase: "agile software", weight: 7, lane: "product" },
  { phrase: "devsecops", weight: 6, lane: "product" },
  { phrase: "low-code", weight: 5, lane: "product" },
  { phrase: "section 508", weight: 4, lane: "web" },
  { phrase: "508 compliant", weight: 4, lane: "web" },
  { phrase: "human centered design", weight: 6, lane: "design" },
  { phrase: "human-centered design", weight: 6, lane: "design" },
  { phrase: "branding and identity", weight: 6, lane: "design" },
];

const SAM_VETOES = [
  "base operations",
  "custodial",
  "grounds maintenance",
  "chancery",
  "barracks",
  "commissary",
];

const DEVOLVED_EXTRA: Signal[] = [
  { phrase: "gwefan", weight: 7, lane: "web" },
  { phrase: "meddalwedd", weight: 7, lane: "product" },
];

const UK_SHARED: Omit<Profile, "extraSignals" | "extraTitleVetoes"> = {
  bodyWeight: 0.5,
  minScore: 6,
  minLanguage: 5,
  codes: CPV_CODES,
  codeVetoPrefixes: UK_CPV_VETO,
  codeAlone: false,
};

const PROFILES: Record<MatchSource, Profile> = {
  "contracts-finder": {
    ...UK_SHARED,
    extraSignals: UK_EXTRA,
    extraTitleVetoes: ["dps for construction", "highways maintenance"],
    minScore: 5,
    minLanguage: 4,
  },
  "find-a-tender": {
    ...UK_SHARED,
    extraSignals: UK_EXTRA,
    extraTitleVetoes: [],
    bodyWeight: 0.4,
    minScore: 7,
  },
  sell2wales: {
    ...UK_SHARED,
    extraSignals: [...UK_EXTRA, ...DEVOLVED_EXTRA],
    extraTitleVetoes: [],
  },
  "public-contracts-scotland": {
    ...UK_SHARED,
    extraSignals: UK_EXTRA,
    extraTitleVetoes: [],
  },
  "sam-gov": {
    bodyWeight: 0.35,
    minScore: 7,
    minLanguage: 5,
    extraSignals: SAM_EXTRA,
    extraTitleVetoes: SAM_VETOES,
    codes: NAICS_CODES,
    codeVetoPrefixes: SAM_NAICS_VETO,
    codeAlone: false,
  },
  "canada-buys": {
    bodyWeight: 0.45,
    minScore: 6,
    minLanguage: 5,
    extraSignals: [
      { phrase: "canada.ca", weight: 4, lane: "web" },
      { phrase: "gcintranet", weight: 5, lane: "web" },
      { phrase: "official languages", weight: 3, lane: "web" },
      { phrase: "bilingual", weight: 2, lane: "web" },
    ],
    extraTitleVetoes: ["snow removal", "janitorial"],
    codes: UNSPSC_CODES,
    codeVetoPrefixes: UNSPSC_VETO,
    codeAlone: false,
  },
};

function haystack(parts: Array<string | undefined | null>) {
  return ` ${parts.filter(Boolean).join(" ").toLowerCase()} `;
}

function phraseRx(phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i");
}

function hits(text: string, phrase: string) {
  return phraseRx(phrase).test(text);
}

function applySignals(text: string, signals: Signal[], multiplier: number) {
  let score = 0;
  const reasons: string[] = [];
  const lanes = new Map<Lane, number>();
  for (const signal of signals) {
    if (!hits(text, signal.phrase)) continue;
    const add = signal.weight * multiplier;
    score += add;
    reasons.push(signal.phrase);
    lanes.set(signal.lane, (lanes.get(signal.lane) || 0) + add);
  }
  return { score, reasons, lanes };
}

function mergeLanes(into: Map<Lane, number>, from: Map<Lane, number>) {
  for (const [lane, value] of from) {
    into.set(lane, (into.get(lane) || 0) + value);
  }
}

function hasAny(text: string, phrases: string[]) {
  return phrases.find((phrase) => hits(text, phrase)) || null;
}

export function classifyDigital(input: {
  source: MatchSource;
  title?: string;
  description?: string;
  cpvId?: string;
  cpvDescription?: string;
}): Classification {
  const profile = PROFILES[input.source];
  const title = haystack([input.title]);
  const body = haystack([input.description, input.cpvDescription]);
  const all = haystack([input.title, input.description, input.cpvDescription]);
  const code = (input.cpvId || "").replace(/\s/g, "");
  const reasons: string[] = [];
  const lanes = new Map<Lane, number>();
  const signals = [...CORE_SIGNALS, ...profile.extraSignals];

  const titleVeto = hasAny(title, [...TITLE_VETO, ...profile.extraTitleVetoes]);
  if (titleVeto) {
    return { digital: false, score: 0, reasons: [`${input.source}: excluded “${titleVeto}”`], lanes: [] };
  }

  if (code && profile.codeVetoPrefixes.some((prefix) => code.startsWith(prefix))) {
    return { digital: false, score: 0, reasons: [`${input.source}: excluded code ${code}`], lanes: [] };
  }

  const titleHits = applySignals(title, signals, 1);
  const bodyHits = applySignals(body, [...signals, ...BODY_ONLY], profile.bodyWeight);
  mergeLanes(lanes, titleHits.lanes);
  mergeLanes(lanes, bodyHits.lanes);

  let score = titleHits.score + Math.min(bodyHits.score, 6);
  for (const phrase of titleHits.reasons.slice(0, 4)) reasons.push(`Title: ${phrase}`);
  for (const phrase of bodyHits.reasons.slice(0, 2)) {
    if (titleHits.reasons.includes(phrase)) continue;
    reasons.push(`Copy: ${phrase}`);
  }

  if (code) {
    const mapped = profile.codes.find((row) => code.startsWith(row.prefix));
    if (mapped) {
      score += mapped.weight;
      lanes.set(mapped.lane, (lanes.get(mapped.lane) || 0) + mapped.weight);
      reasons.push(mapped.label);
    }
  }

  const bodyVeto = hasAny(all, BODY_VETO);
  if (bodyVeto && titleHits.score < 6) {
    return { digital: false, score: 0, reasons: [`${input.source}: excluded “${bodyVeto}”`], lanes: [] };
  }

  const rankedLanes = [...lanes.entries()].sort((a, b) => b[1] - a[1]).map(([lane]) => lane);
  const language = titleHits.score >= profile.minLanguage || bodyHits.score >= profile.minLanguage;
  const digital = language && score >= profile.minScore;

  return {
    digital,
    score: Math.round(score * 10) / 10,
    reasons: (digital ? reasons : reasons).slice(0, 6),
    lanes: rankedLanes,
  };
}
