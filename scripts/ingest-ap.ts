#!/usr/bin/env tsx
/**
 * AP (Autoriteit Persoonsgegevens) ingestion crawler.
 *
 * Scrapes the AP website (autoriteitpersoonsgegevens.nl) for:
 *   - Boetebesluiten (fine decisions)
 *   - Handhavingsbesluiten / lasten onder dwangsom (enforcement decisions)
 *   - Guidance documents (handleidingen, normuitleg, richtsnoeren, adviezen)
 *
 * Populates the SQLite database used by the MCP server.
 *
 * Usage:
 *   npx tsx scripts/ingest-ap.ts                   # Full ingestion
 *   npx tsx scripts/ingest-ap.ts --resume           # Skip already-ingested references
 *   npx tsx scripts/ingest-ap.ts --dry-run           # Parse and log, do not write to DB
 *   npx tsx scripts/ingest-ap.ts --force             # Drop existing data and re-ingest
 *
 * Environment:
 *   AP_DB_PATH     — SQLite database path (default: data/ap.db)
 *   AP_USER_AGENT  — Custom User-Agent header (default: built-in)
 *   AP_RATE_LIMIT  — Milliseconds between requests (default: 1500)
 *   AP_MAX_RETRIES — Max retry attempts per request (default: 3)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// cheerio — loaded dynamically so the script fails fast with a clear message
// ---------------------------------------------------------------------------

let cheerio: typeof import("cheerio");
try {
  cheerio = await import("cheerio");
} catch {
  console.error(
    "Missing dependency: cheerio\n" +
      "Install it with:  npm install --save-dev cheerio @types/cheerio\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["AP_DB_PATH"] ?? "data/ap.db";
const USER_AGENT =
  process.env["AP_USER_AGENT"] ??
  "AnsvarAPCrawler/1.0 (+https://ansvar.eu; data-protection-research)";
const RATE_LIMIT_MS = parseInt(
  process.env["AP_RATE_LIMIT"] ?? "1500",
  10,
);
const MAX_RETRIES = parseInt(
  process.env["AP_MAX_RETRIES"] ?? "3",
  10,
);

const BASE_URL = "https://www.autoriteitpersoonsgegevens.nl";

// CLI flags
const args = new Set(process.argv.slice(2));
const FLAG_RESUME = args.has("--resume");
const FLAG_DRY_RUN = args.has("--dry-run");
const FLAG_FORCE = args.has("--force");

// ---------------------------------------------------------------------------
// Known AP decision and guidance URLs
//
// The AP website (Drupal) returns 403 to bare fetch() calls on listing pages,
// but individual document pages are accessible. We maintain a curated index
// of known document URLs. The crawler fetches each page, extracts structured
// content, and inserts it into the database.
//
// Listing pages are attempted first (/boetes-en-andere-sancties and
// /documenten) to discover new URLs. If the listing fetch fails (403),
// the crawler falls back to the curated index below.
// ---------------------------------------------------------------------------

/** Decision source entry — URL + optional pre-known metadata for fallback. */
interface DecisionSource {
  url: string;
  /** Stable reference ID (e.g. "AP-BOETE-TIKTOK"). Generated from slug if absent. */
  reference?: string;
  /** Decision type hint — overridden by page content if available. */
  type?: "boete" | "last_onder_dwangsom" | "besluit" | "berisping";
}

/** Guidance source entry. */
interface GuidelineSource {
  url: string;
  reference?: string;
  type?: "handleiding" | "normuitleg" | "richtsnoer" | "beleidsregel" | "advies" | "handreiking";
}

// -- Curated decision URLs (fine decisions + enforcement orders) -------------

const KNOWN_DECISIONS: DecisionSource[] = [
  // Boetes (fines)
  { url: "/documenten/boete-tiktok-recht-op-informatie", type: "boete" },
  { url: "/documenten/boete-uber-doorgifte-naar-vs", type: "boete" },
  { url: "/documenten/boete-hagaziekenhuis", type: "boete" },
  { url: "/documenten/boete-knltb", type: "boete" },
  { url: "/documenten/boete-olvg", type: "boete" },
  { url: "/documenten/boete-bkr", type: "boete" },
  { url: "/documenten/boete-han", type: "boete" },
  { url: "/documenten/boete-cpa-verzuimregistratie", type: "boete" },
  { url: "/documenten/boete-dpg-media-kopie-id-bij-inzageverzoek", type: "boete" },
  { url: "/documenten/boete-ministerie-buitenlandse-zaken-nvis", type: "boete" },
  { url: "/documenten/boete-belastingdienst-kinderopvangtoeslag", type: "boete" },
  { url: "/documenten/boete-belastingdienst-zwarte-lijst-fsv", type: "boete" },
  { url: "/documenten/boete-mobiele-camera-autos-rotterdam", type: "boete" },
  // Clearview decision (English page also available)
  { url: "/documenten/boete-clearview-ai", type: "boete" },
  // Lasten onder dwangsom (periodic penalty orders)
  { url: "/documenten/last-onder-dwangsom-uwv-werkgeversportaal", type: "last_onder_dwangsom" },
  { url: "/documenten/besluit-last-onder-dwangsom-vgz", type: "last_onder_dwangsom" },
  { url: "/documenten/last-onder-dwangsom-tgb", type: "last_onder_dwangsom" },
  { url: "/documenten/besluit-last-onder-dwangsom-menzis", type: "last_onder_dwangsom" },
  { url: "/documenten/controle-last-onder-dwangsom-hagaziekenhuis", type: "last_onder_dwangsom" },
  // Besluiten op bezwaar (decisions on objection)
  { url: "/documenten/beslissing-op-bezwaar-hagaziekenhuis", type: "besluit" },
  { url: "/documenten/besluit-op-bezwaar-as-watson-kruidvat", type: "besluit" },
];

// -- Curated guidance URLs ---------------------------------------------------

const KNOWN_GUIDELINES: GuidelineSource[] = [
  // Richtsnoeren (guidelines)
  { url: "/documenten/richtsnoeren-beveiliging-van-persoonsgegevens", type: "richtsnoer" },
  // Handreikingen (guidance documents)
  { url: "/documenten/handreiking-wet-gemeentelijke-schuldhulpverlening", type: "handreiking" },
  { url: "/documenten/handreiking-de-rvc-of-rvt-en-privacy-uw-rol-als-toezichthouder", type: "handreiking" },
  { url: "/documenten/handreiking-privacy-in-een-jaarverslag", type: "handreiking" },
  { url: "/documenten/handreiking-cross-sectorale-zwarte-lijsten", type: "handreiking" },
  { url: "/documenten/handreiking-scraping-door-particulieren-en-private-organisaties", type: "handreiking" },
  // Beleidsregels (policy rules)
  { url: "/documenten/boetebeleidsregels-autoriteit-persoonsgegevens-2023", type: "beleidsregel" },
  { url: "/documenten/wijziging-beleidsregels-openbaarmaking-door-de-autoriteit-persoonsgegevens", type: "beleidsregel" },
  // Adviezen (advisory opinions)
  { url: "/documenten/advies-geautomatiseerde-besluitvorming", type: "advies" },
  { url: "/documenten/advies-verzamelwet-gegevensbescherming", type: "advies" },
  { url: "/documenten/advies-besluit-gegevensverwerking-door-samenwerkingsverbanden", type: "advies" },
  // Normuitleg and position papers
  { url: "/documenten/position-paper-ap-rondetafelgesprek-toezicht-en-normuitleg-ai", type: "normuitleg" },
  // DPIA list
  { url: "/documenten/lijst-verplichte-dpia", type: "richtsnoer" },
  // Protocol and technical briefings
  { url: "/documenten/protocol-gatekeeper-2024", type: "richtsnoer" },
  { url: "/documenten/technische-briefing-eindadvies-ai-toezicht", type: "advies" },
  // Legislative advice
  { url: "/documenten/toets-wet-implementatie-richtlijn-loontransparantie-mannen-en-vrouwen", type: "advies" },
  { url: "/documenten/toets-wijziging-huisvestingswet-2014", type: "advies" },
  { url: "/documenten/aanvullende-themas-evaluatie-en-wetswijziging-uavg", type: "advies" },
];

// ---------------------------------------------------------------------------
// Listing page URLs — attempted for dynamic discovery
// ---------------------------------------------------------------------------

const DECISION_LIST_URLS = [
  "/boetes-en-andere-sancties",
  "/en/about-the-ap/fines-and-other-sanctions-from-the-ap",
];

const GUIDELINE_LIST_URLS = [
  "/documenten",
  "/en/documents",
];

// ---------------------------------------------------------------------------
// Topic detection — maps Dutch keywords to topic IDs
// ---------------------------------------------------------------------------

interface TopicRule {
  id: string;
  name_nl: string;
  name_en: string;
  description: string;
  /** Keywords to match in title + summary + full_text (case-insensitive). */
  keywords: string[];
}

const TOPIC_RULES: TopicRule[] = [
  {
    id: "kinderen",
    name_nl: "Kinderen en minderjarigen",
    name_en: "Children and minors",
    description:
      "Verwerking van persoonsgegevens van kinderen, waaronder toestemming door ouders en beveiliging van gegevens van minderjarigen (art. 8 AVG).",
    keywords: ["kind", "minderjarig", "jeugd", "leerling", "student", "school", "children"],
  },
  {
    id: "cookies",
    name_nl: "Cookies en tracking",
    name_en: "Cookies and tracking",
    description:
      "Plaatsen en uitlezen van cookies en vergelijkbare technieken op apparaten van gebruikers (art. 11.7a Telecommunicatiewet).",
    keywords: ["cookie", "tracking", "tracker", "telecommunicatiewet"],
  },
  {
    id: "profilering",
    name_nl: "Profilering en geautomatiseerde besluitvorming",
    name_en: "Profiling and automated decision-making",
    description:
      "Geautomatiseerde verwerking van persoonsgegevens voor profilering, inclusief discriminatoir gebruik (art. 22 AVG).",
    keywords: [
      "profilering", "profiling", "algoritme", "algorithm",
      "geautomatiseerd", "automated", "besluitvorming",
      "risicoselectie", "fraudedetectie", "ai", "machine learning",
    ],
  },
  {
    id: "beveiliging",
    name_nl: "Beveiliging van persoonsgegevens",
    name_en: "Security of personal data",
    description:
      "Technische en organisatorische maatregelen ter beveiliging van persoonsgegevens (art. 32 AVG).",
    keywords: [
      "beveiliging", "security", "versleuteling", "encryptie",
      "tweefactorauthenticatie", "2fa", "mfa", "wachtwoord",
      "password", "hack", "lek", "inbraak", "ongeautoriseerd",
    ],
  },
  {
    id: "datalekken",
    name_nl: "Datalekken en meldplicht",
    name_en: "Data breaches and notification",
    description: "Melding van datalekken aan de AP en betrokkenen (art. 33-34 AVG).",
    keywords: [
      "datalek", "data breach", "meldplicht", "notification",
      "incident", "inbreuk", "72 uur",
    ],
  },
  {
    id: "toestemming",
    name_nl: "Toestemming",
    name_en: "Consent",
    description:
      "Geldige toestemming als grondslag voor gegevensverwerking (art. 6 en 7 AVG).",
    keywords: ["toestemming", "consent", "instemming", "opt-in", "opt-out"],
  },
  {
    id: "cameratoezicht",
    name_nl: "Cameratoezicht",
    name_en: "Camera surveillance",
    description:
      "Gebruik van camerasystemen op de werkvloer, in publieke ruimten, en in semi-publieke ruimten.",
    keywords: ["camera", "cameratoezicht", "surveillance", "videobewaking", "beeldmateriaal"],
  },
  {
    id: "grondrechten",
    name_nl: "Grondrechten en discriminatie",
    name_en: "Fundamental rights and discrimination",
    description:
      "Bescherming van grondrechten bij gegevensverwerking, inclusief verbod op discriminatoire algoritmen.",
    keywords: [
      "discriminatie", "discrimination", "grondrecht",
      "fundamental right", "etnisch", "ethnic", "ras",
      "nationaliteit", "geslacht", "bias",
    ],
  },
  {
    id: "doorgifte",
    name_nl: "Internationale doorgifte",
    name_en: "International transfers",
    description:
      "Doorgifte van persoonsgegevens naar derde landen of internationale organisaties (art. 44-49 AVG).",
    keywords: [
      "doorgifte", "transfer", "derde land", "third country",
      "adequaatheidsbesluit", "adequacy", "schrems",
      "standard contractual", "bcr", "binding corporate",
    ],
  },
  {
    id: "gezondheid",
    name_nl: "Gezondheidsgegevens",
    name_en: "Health data",
    description:
      "Verwerking van gezondheidsgegevens en medische dossiers (art. 9 AVG).",
    keywords: [
      "gezondheid", "health", "medisch", "medical", "patient",
      "ziekenhuis", "hospital", "zorgverzekeraar", "zorg",
      "diagnose", "behandeling",
    ],
  },
  {
    id: "biometrie",
    name_nl: "Biometrische gegevens",
    name_en: "Biometric data",
    description:
      "Verwerking van biometrische gegevens voor identificatie (art. 9 AVG).",
    keywords: [
      "biometrisch", "biometric", "gezichtsherkenning",
      "facial recognition", "vingerafdruk", "fingerprint",
      "iris", "stemherkenning",
    ],
  },
  {
    id: "rechten_betrokkenen",
    name_nl: "Rechten van betrokkenen",
    name_en: "Data subject rights",
    description:
      "Recht op inzage, rectificatie, vergetelheid, beperking, overdraagbaarheid en bezwaar (art. 15-21 AVG).",
    keywords: [
      "inzage", "access", "rectificatie", "vergetelheid",
      "erasure", "verwijdering", "removal", "bezwaar", "objection",
      "overdraagbaarheid", "portability",
    ],
  },
];

// ---------------------------------------------------------------------------
// GDPR article detection — extracts article numbers from text
// ---------------------------------------------------------------------------

const GDPR_ARTICLE_PATTERN =
  /\bart(?:ikel|\.)\s*(\d+(?:\s*(?:lid|,\s*\d+))*)\s*(?:AVG|GDPR|UAVG|Wbp)?/gi;

function extractGdprArticles(text: string): string[] {
  const articles = new Set<string>();
  let match: RegExpExecArray | null;

  // Match "art. 5", "artikel 32", "art. 5, 6 en 13 AVG", etc.
  while ((match = GDPR_ARTICLE_PATTERN.exec(text)) !== null) {
    const numStr = match[1];
    if (!numStr) continue;

    // Split compound references: "5, 6 en 13" → ["5", "6", "13"]
    const nums = numStr.split(/[,\sen]+/).map((s) => s.trim()).filter(Boolean);
    for (const n of nums) {
      const parsed = parseInt(n, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 99) {
        articles.add(String(parsed));
      }
    }
  }

  // Also match "artikel 5 lid 1 sub a AVG" pattern
  const lidPattern =
    /\bart(?:ikel|\.)\s*(\d+)\s+lid\s+(\d+)/gi;
  while ((match = lidPattern.exec(text)) !== null) {
    const art = match[1];
    if (art) {
      const parsed = parseInt(art, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 99) {
        articles.add(String(parsed));
      }
    }
  }

  return [...articles].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

// ---------------------------------------------------------------------------
// Topic detection
// ---------------------------------------------------------------------------

function detectTopics(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const rule of TOPIC_RULES) {
    const hit = rule.keywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (hit) {
      matched.push(rule.id);
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Fine amount extraction
// ---------------------------------------------------------------------------

const FINE_PATTERNS = [
  // "750.000 euro", "3.700.000 euro", "30.500.000 euro"
  /(\d{1,3}(?:\.\d{3})*)\s*euro/gi,
  // "EUR 750,000", "EUR 3,700,000"
  /EUR\s*(\d{1,3}(?:,\d{3})*)/gi,
  // "€ 750.000", "€750.000", "€ 3.700.000"
  /\u20ac\s*(\d{1,3}(?:\.\d{3})*)/gi,
];

function extractFineAmount(text: string): number | null {
  let maxFine = 0;

  for (const pattern of FINE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const rawNum = match[1];
      if (!rawNum) continue;

      // Parse Dutch-format "3.700.000" or English "3,700,000"
      const normalized = rawNum.replace(/[.,]/g, "");
      const amount = parseInt(normalized, 10);

      if (!isNaN(amount) && amount > maxFine) {
        maxFine = amount;
      }
    }
  }

  return maxFine > 0 ? maxFine : null;
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

const DUTCH_MONTHS: Record<string, string> = {
  januari: "01", februari: "02", maart: "03", april: "04",
  mei: "05", juni: "06", juli: "07", augustus: "08",
  september: "09", oktober: "10", november: "11", december: "12",
};

function extractDate(text: string): string | null {
  // "16 juli 2021", "24 oktober 2023"
  const nlMatch = text.match(
    /(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i,
  );
  if (nlMatch) {
    const day = (nlMatch[1] ?? "").padStart(2, "0");
    const month = DUTCH_MONTHS[(nlMatch[2] ?? "").toLowerCase()];
    const year = nlMatch[3];
    if (month && year) {
      return `${year}-${month}-${day}`;
    }
  }

  // ISO date: "2023-09-13"
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    return isoMatch[1] ?? null;
  }

  // "13 September 2023" (English months)
  const enMonths: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const enMatch = text.match(
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
  );
  if (enMatch) {
    const day = (enMatch[1] ?? "").padStart(2, "0");
    const month = enMonths[(enMatch[2] ?? "").toLowerCase()];
    const year = enMatch[3];
    if (month && year) {
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entity name extraction from title
// ---------------------------------------------------------------------------

function extractEntityFromTitle(title: string): string | null {
  // Patterns like "Boete TikTok ...", "Boete HagaZiekenhuis", "Last onder dwangsom UWV ..."
  // Try to get the entity name after the decision type keyword
  const patterns = [
    /^Boete\s+(.+?)(?:\s+(?:recht|wegens|voor|vanwege|kopie|zwarte|doorgifte|kinderopvang|verzuim|mobiele))/i,
    /^Boete\s+(.+)$/i,
    /^Besluit\s+(?:boete\s+)?(.+?)(?:\s+(?:recht|wegens|voor|vanwege))/i,
    /^Last\s+onder\s+dwangsom\s+(.+)$/i,
    /^Besluit\s+last\s+onder\s+dwangsom\s+(.+)$/i,
    /^Controle\s+last\s+onder\s+dwangsom\s+(.+)$/i,
    /^Beslissing\s+op\s+bezwaar\s+(.+)$/i,
    /^Besluit\s+op\s+bezwaar\s+(.+?)(?:\s*-\s*|\s*$)/i,
  ];

  for (const pat of patterns) {
    const m = title.match(pat);
    if (m && m[1]) {
      return m[1].trim();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP fetch with retry, rate limiting, and proper headers
// ---------------------------------------------------------------------------

let lastFetchTime = 0;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url: string): Promise<Response | null> {
  const now = Date.now();
  const elapsed = now - lastFetchTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      lastFetchTime = Date.now();
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.5",
        },
        redirect: "follow",
      });

      if (res.ok) {
        return res;
      }

      // 429 Too Many Requests — back off
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "10", 10);
        console.warn(`  Rate limited (429), waiting ${retryAfter}s before retry ${attempt}/${MAX_RETRIES}`);
        await sleep(retryAfter * 1000);
        continue;
      }

      // 403 Forbidden — the AP blocks certain requests; skip after 1 attempt
      if (res.status === 403) {
        console.warn(`  Blocked (403): ${url}`);
        return null;
      }

      // 404 Not Found — page does not exist
      if (res.status === 404) {
        console.warn(`  Not found (404): ${url}`);
        return null;
      }

      // Other server errors — retry with backoff
      if (res.status >= 500) {
        console.warn(`  Server error (${res.status}), retry ${attempt}/${MAX_RETRIES}: ${url}`);
        await sleep(2000 * attempt);
        continue;
      }

      // Unexpected status
      console.warn(`  HTTP ${res.status} for ${url}`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Network error (attempt ${attempt}/${MAX_RETRIES}): ${msg}`);
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * attempt);
      }
    }
  }

  console.error(`  Failed after ${MAX_RETRIES} retries: ${url}`);
  return null;
}

// ---------------------------------------------------------------------------
// HTML page parsing
// ---------------------------------------------------------------------------

interface ParsedDecision {
  reference: string;
  title: string;
  date: string | null;
  type: string;
  entity_name: string | null;
  fine_amount: number | null;
  summary: string | null;
  full_text: string;
  topics: string;
  gdpr_articles: string;
  status: string;
  source_url: string;
}

interface ParsedGuideline {
  reference: string | null;
  title: string;
  date: string | null;
  type: string;
  summary: string | null;
  full_text: string;
  topics: string;
  language: string;
  source_url: string;
}

/**
 * Generate a stable reference from a URL slug.
 * "/documenten/boete-tiktok-recht-op-informatie" → "AP-BOETE-TIKTOK-RECHT-OP-INFORMATIE"
 */
function referenceFromSlug(url: string): string {
  const slug = url.split("/").pop() ?? url;
  return `AP-${slug.toUpperCase()}`;
}

/**
 * Infer decision type from the page title or URL slug.
 */
function inferDecisionType(title: string, slug: string): string {
  const lower = (title + " " + slug).toLowerCase();
  if (lower.includes("boete") || lower.includes("fine")) return "boete";
  if (lower.includes("last onder dwangsom") || lower.includes("dwangsom")) return "last_onder_dwangsom";
  if (lower.includes("berisping") || lower.includes("reprimand")) return "berisping";
  if (lower.includes("bezwaar")) return "besluit";
  return "besluit";
}

/**
 * Parse an individual AP document page and extract structured data.
 *
 * The AP website (Drupal-based) uses this general HTML structure:
 *   <h1 class="page-title">Boete TikTok recht op informatie</h1>
 *   <div class="field--name-body"> ... decision text ... </div>
 *   <time datetime="2021-07-16">16 juli 2021</time>
 *
 * When the page cannot be parsed (403, different structure), returns null.
 */
function parseDocumentPage(
  html: string,
  sourceUrl: string,
): { title: string; date: string | null; bodyText: string; summaryText: string | null } | null {
  const $ = cheerio.load(html);

  // -- Title --
  let title =
    $("h1.page-title").first().text().trim() ||
    $("h1").first().text().trim() ||
    $("title").text().replace(/\s*\|\s*Autoriteit Persoonsgegevens.*$/, "").trim();

  if (!title) {
    console.warn(`  No title found on ${sourceUrl}`);
    return null;
  }

  // -- Date --
  // Try <time datetime="..."> first, then metadata fields, then scan body
  let date: string | null = null;

  const timeEl = $("time[datetime]").first();
  if (timeEl.length > 0) {
    date = timeEl.attr("datetime")?.slice(0, 10) ?? null;
  }

  if (!date) {
    // Meta tag: <meta property="article:published_time" content="2023-09-13T...">
    const metaDate = $('meta[property="article:published_time"]').attr("content");
    if (metaDate) {
      date = metaDate.slice(0, 10);
    }
  }

  // -- Body text --
  // Primary: .field--name-body (Drupal body field)
  // Fallback: article, .node__content, main
  let bodyHtml =
    $(".field--name-body").html() ??
    $(".field--name-field-body").html() ??
    $("article .node__content").html() ??
    $("article").html() ??
    $("main .content").html() ??
    $("main").html() ??
    "";

  // Strip HTML tags, normalize whitespace
  const body$ = cheerio.load(bodyHtml);
  // Remove nav, header, footer, script, style elements
  body$("nav, header, footer, script, style, .breadcrumb, .pager, .sidebar").remove();

  let bodyText = body$.text().replace(/\s+/g, " ").trim();

  if (!bodyText || bodyText.length < 50) {
    // Try the whole page as fallback
    const page$ = cheerio.load(html);
    page$("nav, header, footer, script, style, .breadcrumb, .pager, .sidebar, .menu").remove();
    bodyText = page$("main").text().replace(/\s+/g, " ").trim();
  }

  if (!bodyText || bodyText.length < 30) {
    console.warn(`  Body text too short (${bodyText.length} chars) on ${sourceUrl}`);
    return null;
  }

  // -- Summary --
  // Try to extract the first meaningful paragraph as summary
  let summaryText: string | null = null;
  const firstParagraph = $(".field--name-body p").first().text().trim() ||
    $("article p").first().text().trim();
  if (firstParagraph && firstParagraph.length > 30 && firstParagraph.length < 1000) {
    summaryText = firstParagraph;
  }

  // If we couldn't get date from HTML, try extracting from body text
  if (!date) {
    date = extractDate(bodyText);
  }

  return { title, date, bodyText, summaryText };
}

// ---------------------------------------------------------------------------
// Listing page parsing — discover decision/guidance URLs dynamically
// ---------------------------------------------------------------------------

function parseListingPage(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];

  // Look for links to individual documents
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Resolve relative URLs
    let fullUrl: string;
    if (href.startsWith("http")) {
      fullUrl = href;
    } else if (href.startsWith("/")) {
      fullUrl = href;
    } else {
      return;
    }

    // Filter: only /documenten/* pages
    if (fullUrl.includes("/documenten/") && !fullUrl.includes("#")) {
      // Normalize to path-only
      const path = fullUrl.replace(BASE_URL, "").split("?")[0];
      if (path && !urls.includes(path)) {
        urls.push(path);
      }
    }
  });

  return urls;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

function initDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`Created data directory: ${dir}`);
  }

  if (FLAG_FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log(`Deleted existing database (--force)`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);

  return db;
}

function getExistingReferences(db: Database.Database): Set<string> {
  const refs = new Set<string>();
  const rows = db.prepare("SELECT reference FROM decisions").all() as Array<{ reference: string }>;
  for (const row of rows) {
    refs.add(row.reference);
  }
  return refs;
}

function getExistingGuidelineRefs(db: Database.Database): Set<string> {
  const refs = new Set<string>();
  const rows = db
    .prepare("SELECT reference FROM guidelines WHERE reference IS NOT NULL")
    .all() as Array<{ reference: string }>;
  for (const row of rows) {
    refs.add(row.reference);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Main ingestion logic
// ---------------------------------------------------------------------------

interface IngestStats {
  decisionsIngested: number;
  decisionsSkipped: number;
  decisionsFailed: number;
  guidelinesIngested: number;
  guidelinesSkipped: number;
  guidelinesFailed: number;
  discoveredUrls: number;
}

async function discoverUrls(listUrls: string[]): Promise<string[]> {
  const discovered: string[] = [];

  for (const listPath of listUrls) {
    const url = `${BASE_URL}${listPath}`;
    console.log(`Attempting listing page: ${url}`);
    const res = await rateLimitedFetch(url);
    if (!res) {
      console.log(`  Listing page unavailable, using curated index`);
      continue;
    }

    const html = await res.text();
    const urls = parseListingPage(html, BASE_URL);
    console.log(`  Discovered ${urls.length} document URLs from ${listPath}`);
    discovered.push(...urls);
  }

  return [...new Set(discovered)];
}

async function ingestDecision(
  db: Database.Database,
  source: DecisionSource,
  existingRefs: Set<string>,
  stats: IngestStats,
): Promise<void> {
  const reference = source.reference ?? referenceFromSlug(source.url);

  if (FLAG_RESUME && existingRefs.has(reference)) {
    console.log(`  [skip] ${reference} (already in DB)`);
    stats.decisionsSkipped++;
    return;
  }

  const fullUrl = `${BASE_URL}${source.url}`;
  console.log(`  Fetching: ${fullUrl}`);

  const res = await rateLimitedFetch(fullUrl);
  if (!res) {
    stats.decisionsFailed++;
    return;
  }

  const html = await res.text();
  const parsed = parseDocumentPage(html, source.url);
  if (!parsed) {
    stats.decisionsFailed++;
    return;
  }

  const { title, date, bodyText, summaryText } = parsed;
  const type = source.type ?? inferDecisionType(title, source.url);
  const entityName = extractEntityFromTitle(title);
  const fineAmount = extractFineAmount(bodyText);
  const topics = detectTopics(`${title} ${summaryText ?? ""} ${bodyText}`);
  const gdprArticles = extractGdprArticles(bodyText);

  const decision: ParsedDecision = {
    reference,
    title,
    date,
    type,
    entity_name: entityName,
    fine_amount: fineAmount,
    summary: summaryText,
    full_text: bodyText,
    topics: JSON.stringify(topics),
    gdpr_articles: JSON.stringify(gdprArticles),
    status: "final",
    source_url: fullUrl,
  };

  if (FLAG_DRY_RUN) {
    console.log(`  [dry-run] Would insert decision: ${reference}`);
    console.log(`    Title: ${title}`);
    console.log(`    Date: ${date ?? "unknown"}`);
    console.log(`    Entity: ${entityName ?? "unknown"}`);
    console.log(`    Fine: ${fineAmount != null ? `${fineAmount.toLocaleString("nl-NL")} EUR` : "N/A"}`);
    console.log(`    Type: ${type}`);
    console.log(`    Topics: ${topics.join(", ") || "none detected"}`);
    console.log(`    GDPR articles: ${gdprArticles.join(", ") || "none detected"}`);
    console.log(`    Body length: ${bodyText.length} chars`);
    stats.decisionsIngested++;
    return;
  }

  try {
    db.prepare(`
      INSERT OR REPLACE INTO decisions
        (reference, title, date, type, entity_name, fine_amount, summary, full_text, topics, gdpr_articles, status)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.reference,
      decision.title,
      decision.date,
      decision.type,
      decision.entity_name,
      decision.fine_amount,
      decision.summary,
      decision.full_text,
      decision.topics,
      decision.gdpr_articles,
      decision.status,
    );
    console.log(`  [ok] Inserted decision: ${reference}`);
    stats.decisionsIngested++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [error] Failed to insert ${reference}: ${msg}`);
    stats.decisionsFailed++;
  }
}

async function ingestGuideline(
  db: Database.Database,
  source: GuidelineSource,
  existingRefs: Set<string>,
  stats: IngestStats,
): Promise<void> {
  const reference = source.reference ?? referenceFromSlug(source.url);

  if (FLAG_RESUME && existingRefs.has(reference)) {
    console.log(`  [skip] ${reference} (already in DB)`);
    stats.guidelinesSkipped++;
    return;
  }

  const fullUrl = `${BASE_URL}${source.url}`;
  console.log(`  Fetching: ${fullUrl}`);

  const res = await rateLimitedFetch(fullUrl);
  if (!res) {
    stats.guidelinesFailed++;
    return;
  }

  const html = await res.text();
  const parsed = parseDocumentPage(html, source.url);
  if (!parsed) {
    stats.guidelinesFailed++;
    return;
  }

  const { title, date, bodyText, summaryText } = parsed;
  const type = source.type ?? "advies";
  const topics = detectTopics(`${title} ${summaryText ?? ""} ${bodyText}`);

  // Detect language — English documents exist on /en/ paths
  const language = source.url.includes("/en/") ? "en" : "nl";

  const guideline: ParsedGuideline = {
    reference,
    title,
    date,
    type,
    summary: summaryText,
    full_text: bodyText,
    topics: JSON.stringify(topics),
    language,
    source_url: fullUrl,
  };

  if (FLAG_DRY_RUN) {
    console.log(`  [dry-run] Would insert guideline: ${reference ?? "(no ref)"}`);
    console.log(`    Title: ${title}`);
    console.log(`    Date: ${date ?? "unknown"}`);
    console.log(`    Type: ${type}`);
    console.log(`    Topics: ${topics.join(", ") || "none detected"}`);
    console.log(`    Language: ${language}`);
    console.log(`    Body length: ${bodyText.length} chars`);
    stats.guidelinesIngested++;
    return;
  }

  try {
    db.prepare(`
      INSERT INTO guidelines
        (reference, title, date, type, summary, full_text, topics, language)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      guideline.reference,
      guideline.title,
      guideline.date,
      guideline.type,
      guideline.summary,
      guideline.full_text,
      guideline.topics,
      guideline.language,
    );
    console.log(`  [ok] Inserted guideline: ${reference}`);
    stats.guidelinesIngested++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [error] Failed to insert guideline ${reference}: ${msg}`);
    stats.guidelinesFailed++;
  }
}

function ensureTopics(db: Database.Database): void {
  const insertTopic = db.prepare(
    "INSERT OR IGNORE INTO topics (id, name_nl, name_en, description) VALUES (?, ?, ?, ?)",
  );

  const insertAll = db.transaction(() => {
    for (const rule of TOPIC_RULES) {
      insertTopic.run(rule.id, rule.name_nl, rule.name_en, rule.description);
    }
  });

  insertAll();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== AP (Autoriteit Persoonsgegevens) Ingestion Crawler ===");
  console.log();
  console.log(`Database:    ${DB_PATH}`);
  console.log(`Rate limit:  ${RATE_LIMIT_MS}ms between requests`);
  console.log(`Max retries: ${MAX_RETRIES}`);
  console.log(`Flags:       ${[
    FLAG_RESUME && "--resume",
    FLAG_DRY_RUN && "--dry-run",
    FLAG_FORCE && "--force",
  ].filter(Boolean).join(" ") || "(none)"}`);
  console.log();

  // -- Init database --------------------------------------------------------
  // Always open the DB — dry-run still needs it for --resume ref checks.
  // Writes are guarded by FLAG_DRY_RUN inside ingestDecision / ingestGuideline.
  const db = initDb();

  ensureTopics(db);
  console.log(`Ensured ${TOPIC_RULES.length} topics in database`);

  const existingDecisionRefs = getExistingReferences(db);
  const existingGuidelineRefs = getExistingGuidelineRefs(db);

  if (FLAG_RESUME) {
    console.log(`Existing decisions: ${existingDecisionRefs.size}`);
    console.log(`Existing guidelines: ${existingGuidelineRefs.size}`);
  }

  const stats: IngestStats = {
    decisionsIngested: 0,
    decisionsSkipped: 0,
    decisionsFailed: 0,
    guidelinesIngested: 0,
    guidelinesSkipped: 0,
    guidelinesFailed: 0,
    discoveredUrls: 0,
  };

  // -- Phase 1: Discover URLs from listing pages ----------------------------
  console.log();
  console.log("--- Phase 1: URL discovery from listing pages ---");

  const discoveredDecisionUrls = await discoverUrls(DECISION_LIST_URLS);
  const discoveredGuidelineUrls = await discoverUrls(GUIDELINE_LIST_URLS);
  stats.discoveredUrls = discoveredDecisionUrls.length + discoveredGuidelineUrls.length;

  // Merge discovered URLs with curated index (curated takes precedence for metadata)
  const curatedDecisionPaths = new Set(KNOWN_DECISIONS.map((d) => d.url));
  const curatedGuidelinePaths = new Set(KNOWN_GUIDELINES.map((g) => g.url));

  const allDecisionSources: DecisionSource[] = [...KNOWN_DECISIONS];
  for (const url of discoveredDecisionUrls) {
    if (!curatedDecisionPaths.has(url)) {
      allDecisionSources.push({ url });
    }
  }

  const allGuidelineSources: GuidelineSource[] = [...KNOWN_GUIDELINES];
  for (const url of discoveredGuidelineUrls) {
    if (!curatedGuidelinePaths.has(url)) {
      // Classify discovered URLs by slug
      const slug = url.split("/").pop() ?? "";
      if (slug.startsWith("boete") || slug.includes("dwangsom") || slug.includes("bezwaar")) {
        // This is actually a decision, add to decisions
        allDecisionSources.push({ url });
        continue;
      }

      const guidelineSource: GuidelineSource = { url };
      if (slug.startsWith("handreiking")) {
        guidelineSource.type = "handreiking";
      } else if (slug.startsWith("richtsnoer")) {
        guidelineSource.type = "richtsnoer";
      } else if (slug.startsWith("advies") || slug.startsWith("toets")) {
        guidelineSource.type = "advies";
      } else if (slug.startsWith("beleidsregel")) {
        guidelineSource.type = "beleidsregel";
      } else if (slug.startsWith("normuitleg") || slug.startsWith("position")) {
        guidelineSource.type = "normuitleg";
      }
      allGuidelineSources.push(guidelineSource);
    }
  }

  console.log(`Total decision sources: ${allDecisionSources.length} (${KNOWN_DECISIONS.length} curated + ${allDecisionSources.length - KNOWN_DECISIONS.length} discovered)`);
  console.log(`Total guideline sources: ${allGuidelineSources.length} (${KNOWN_GUIDELINES.length} curated + ${allGuidelineSources.length - KNOWN_GUIDELINES.length} discovered)`);

  // -- Phase 2: Ingest decisions --------------------------------------------
  console.log();
  console.log("--- Phase 2: Ingesting decisions ---");

  for (const source of allDecisionSources) {
    await ingestDecision(db, source, existingDecisionRefs, stats);
  }

  // -- Phase 3: Ingest guidelines -------------------------------------------
  console.log();
  console.log("--- Phase 3: Ingesting guidelines ---");

  for (const source of allGuidelineSources) {
    await ingestGuideline(db, source, existingGuidelineRefs, stats);
  }

  // -- Summary --------------------------------------------------------------
  console.log();
  console.log("=== Ingestion Complete ===");
  console.log();
  console.log(`Decisions:`);
  console.log(`  Ingested: ${stats.decisionsIngested}`);
  console.log(`  Skipped:  ${stats.decisionsSkipped}`);
  console.log(`  Failed:   ${stats.decisionsFailed}`);
  console.log();
  console.log(`Guidelines:`);
  console.log(`  Ingested: ${stats.guidelinesIngested}`);
  console.log(`  Skipped:  ${stats.guidelinesSkipped}`);
  console.log(`  Failed:   ${stats.guidelinesFailed}`);
  console.log();
  console.log(`Discovered URLs from listing pages: ${stats.discoveredUrls}`);

  const decisionCount = (
    db.prepare("SELECT count(*) as cnt FROM decisions").get() as { cnt: number }
  ).cnt;
  const guidelineCount = (
    db.prepare("SELECT count(*) as cnt FROM guidelines").get() as { cnt: number }
  ).cnt;
  const topicCount = (
    db.prepare("SELECT count(*) as cnt FROM topics").get() as { cnt: number }
  ).cnt;

  console.log();
  console.log(`Database totals:`);
  console.log(`  Topics:     ${topicCount}`);
  console.log(`  Decisions:  ${decisionCount}`);
  console.log(`  Guidelines: ${guidelineCount}`);

  db.close();

  console.log();
  console.log(`Database: ${DB_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
