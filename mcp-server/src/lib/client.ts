/**
 * DeepFetch client.
 *
 * Keyless web research: search, scrape, crawl and structured extraction with
 * zero runtime dependencies beyond Node 18+ globals.
 *
 * Design notes:
 * - No vendor API keys are required for search, scrape or crawl. Search fans out
 *   across public endpoints and merges what answers.
 * - The extract tool runs fully offline in heuristic mode. Set an
 *   OpenAI-compatible endpoint (DEEPFETCH_LLM_*) to have an instruction executed
 *   by a model; that is the only optional network dependency and it is opt-in.
 * - Every outbound request is checked against private address space first so a
 *   crafted URL cannot turn this into an SSRF pivot.
 */

import net from "node:net";

const VERSION = "0.2.0";

// Dual-stack networks with a blackholed IPv6 route make Node's happy-eyeballs
// connect attempts time out on hosts that curl reaches fine (seen on WSL2).
// Force IPv4 unless explicitly opted out.
if (process.env.DEEPFETCH_DUALSTACK !== "1") {
  net.setDefaultAutoSelectFamily(false);
}

const DEFAULT_TIMEOUT_MS = Number(process.env.DEEPFETCH_TIMEOUT_MS || 20000);
const MAX_BYTES = Number(process.env.DEEPFETCH_MAX_BYTES || 3_000_000);
const USER_AGENT =
  process.env.DEEPFETCH_USER_AGENT ||
  `DeepFetch/${VERSION} (+https://github.com/narko4u/deepfetch)`;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
  source?: string;
}

export interface ScrapeResult {
  url: string;
  title?: string;
  markdown: string;
  links?: string[];
  jsonLd?: unknown[];
  truncated?: boolean;
}

export interface CrawlResult {
  url: string;
  pages: Array<{ url: string; title?: string; markdown: string }>;
  skipped?: Array<{ url: string; reason: string }>;
}

export interface ExtractResult {
  url?: string;
  mode: "llm" | "heuristic";
  data: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  copy: "(c)",
  reg: "(R)",
  trade: "(TM)",
  middot: "*",
  bull: "*",
  deg: "deg",
  euro: "EUR",
  pound: "GBP",
  yen: "JPY",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function absolutize(href: string, base: string): string | null {
  const raw = decodeEntities(href.trim());
  if (!raw || raw.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data):/i.test(raw)) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/* SSRF guard                                                          */
/* ------------------------------------------------------------------ */

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid absolute URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https are supported, got ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    isPrivateIPv4(host)
  ) {
    throw new Error(`Refusing to fetch a private or loopback address: ${host}`);
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

interface RawResponse {
  status: number;
  contentType: string;
  text: string;
  finalUrl: string;
}

async function fetchRaw(
  url: string,
  init: { timeoutMs?: number; accept?: string; userAgent?: string } = {}
): Promise<RawResponse> {
  assertPublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": init.userAgent ?? USER_AGENT,
        accept:
          init.accept ??
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "accept-language": "en-AU,en;q=0.9",
      },
    });
    const buffer = await res.arrayBuffer();
    const sliced = buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
    return {
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      text,
      finalUrl: res.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  init: { timeoutMs?: number; accept?: string; userAgent?: string } = {},
  attempts = 2
): Promise<RawResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetchRaw(url, init);
      if (res.status === 429 || res.status === 503) {
        await sleep(600 * (attempt + 1));
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/* ------------------------------------------------------------------ */
/* HTML to markdown                                                    */
/* ------------------------------------------------------------------ */

const NOISE_TAGS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "form",
  "select",
  "textarea",
  "button",
  "nav",
  "footer",
  "aside",
];

function stripNoise(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of NOISE_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  return out;
}

function selectMain(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = body ? body[1] : html;
  const bodyLength = stripTags(bodyHtml).length;

  const regions: string[] = [];
  for (const tag of ["article", "main"]) {
    const open = bodyHtml.search(new RegExp(`<${tag}\\b`, "i"));
    if (open === -1) continue;
    const close = bodyHtml.toLowerCase().lastIndexOf(`</${tag}>`);
    if (close > open) regions.push(bodyHtml.slice(open, close));
  }
  const roleMain = bodyHtml.match(/<div\b[^>]*role=["']main["'][^>]*>[\s\S]*?<\/div>/i);
  if (roleMain) regions.push(roleMain[0]);

  let best: string | null = null;
  let bestLength = 0;
  for (const region of regions) {
    const length = stripTags(region).length;
    const paragraphs = region.match(/<p\b/gi)?.length ?? 0;
    if (paragraphs < 2) continue;
    if (length < bodyLength * 0.25) continue;
    if (length > bestLength) {
      best = region;
      bestLength = length;
    }
  }
  return best ?? bodyHtml;
}

function convertTables(html: string): string {
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    const rows: string[][] = [];
    const rowMatches = inner.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rowMatches) {
      const cells = row.match(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi) || [];
      rows.push(cells.map((cell) => stripTags(cell).replace(/\|/g, "\\|")));
    }
    const usable = rows.filter((r) => r.some((c) => c.length > 0));
    if (usable.length === 0) return "\n\n";
    const width = Math.max(...usable.map((r) => r.length));
    const pad = (r: string[]): string[] => {
      const copy = r.slice();
      while (copy.length < width) copy.push("");
      return copy;
    };
    const lines = [`| ${pad(usable[0]).join(" | ")} |`, `| ${pad(usable[0]).map(() => "---").join(" | ")} |`];
    for (const row of usable.slice(1)) lines.push(`| ${pad(row).join(" | ")} |`);
    return `\n\n${lines.join("\n")}\n\n`;
  });
}

function convertPre(html: string): string {
  return html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const code = decodeEntities(stripTags(inner).replace(/\s+$/, ""));
    const langMatch = /<code\b[^>]*class=["'][^"']*language-([a-z0-9+#-]+)/i.exec(inner);
    const lang = langMatch ? langMatch[1] : "";
    return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
  });
}

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "figure",
  "figcaption",
  "address",
  "details",
  "summary",
  "dl",
  "dt",
  "dd",
  "fieldset",
  "legend",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "tr",
  "td",
  "th",
]);

export function htmlToMarkdown(
  html: string,
  baseUrl: string
): { title: string; markdown: string; links: string[]; jsonLd: unknown[] } {
  const titleMatch =
    /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html) ||
    /<meta\b[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html) ||
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]) : "";

  const links: string[] = [];
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const abs = absolutize(linkMatch[1], baseUrl);
    if (abs && !links.includes(abs)) links.push(abs);
    if (links.length >= 500) break;
  }

  const jsonLd: unknown[] = [];
  const ldRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldRe.exec(html)) !== null) {
    const raw = ldMatch[1].trim();
    if (!raw) continue;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      /* ignore malformed blocks */
    }
  }

  let body = selectMain(stripNoise(html));
  body = convertPre(body);
  body = convertTables(body);

  const tokens = body.match(/<[^>]+>|[^<]+/g) || [];
  const out: string[] = [];
  let capture: { href: string; text: string } | null = null;
  let listDepth = 0;
  let orderedStack: boolean[] = [];
  let counters: number[] = [];
  let inlineCode = false;

  const pushBlock = (): void => {
    out.push("\n\n");
  };

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = capture ? decodeEntities(token) : token;
      if (capture) {
        capture.text += text;
      } else {
        out.push(text.replace(/\s+/g, " "));
      }
      continue;
    }

    const close = token.startsWith("</");
    const nameMatch = /^<\/?\s*([a-z0-9]+)/i.exec(token);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();

    if (name === "br") {
      out.push("\n");
      continue;
    }
    if (name === "hr") {
      out.push("\n\n---\n\n");
      continue;
    }
    if (name === "img" && !close) {
      const src = /src=["']([^"']+)["']/i.exec(token);
      const alt = /alt=["']([^"']*)["']/i.exec(token);
      const abs = src ? absolutize(src[1], baseUrl) : null;
      if (abs) out.push(`![${alt ? alt[1] : ""}](${abs})`);
      continue;
    }
    if (name === "a") {
      if (!close) {
        const href = /href=["']([^"']+)["']/i.exec(token);
        const abs = href ? absolutize(href[1], baseUrl) : null;
        capture = abs ? { href: abs, text: "" } : { href: "", text: "" };
        if (!abs) capture = null;
      } else if (capture) {
        const label = capture.text.replace(/\s+/g, " ").trim();
        if (label) out.push(`[${label}](${capture.href})`);
        capture = null;
      }
      continue;
    }
    if (name === "code") {
      inlineCode = !close;
      out.push("`");
      continue;
    }

    if (/^h[1-6]$/.test(name)) {
      if (close) {
        pushBlock();
      } else {
        const level = Number(name[1]);
        pushBlock();
        out.push(`${"#".repeat(level)} `);
      }
      continue;
    }

    if (name === "ul" || name === "ol") {
      if (!close) {
        listDepth += 1;
        orderedStack.push(name === "ol");
        counters.push(0);
        pushBlock();
      } else {
        listDepth = Math.max(0, listDepth - 1);
        orderedStack.pop();
        counters.pop();
        pushBlock();
      }
      continue;
    }

    if (name === "li") {
      if (close) {
        out.push("\n");
      } else {
        const indent = "  ".repeat(Math.max(0, listDepth - 1));
        const ordered = orderedStack[orderedStack.length - 1] === true;
        if (ordered) {
          counters[counters.length - 1] = (counters[counters.length - 1] ?? 0) + 1;
          out.push(`\n${indent}${counters[counters.length - 1]}. `);
        } else {
          out.push(`\n${indent}- `);
        }
      }
      continue;
    }

    if (name === "strong" || name === "b") {
      if (!inlineCode) out.push(close ? "**" : "**");
      continue;
    }
    if (name === "em" || name === "i") {
      if (!inlineCode) out.push("*");
      continue;
    }
    if (name === "blockquote") {
      pushBlock();
      continue;
    }

    if (BLOCK_TAGS.has(name)) {
      pushBlock();
    }
  }

  let markdown = decodeEntities(out.join(""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  markdown = markdown
    .split("\n")
    .map((line) => line.replace(/\*\*\s*\*\*/g, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!title) {
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1) {
      const text = stripTags(h1[1]);
      if (text.length > 0) {
        markdown = `# ${text}\n\n${markdown}`;
      }
    }
  }

  return { title, markdown, links, jsonLd };
}

/* ------------------------------------------------------------------ */
/* search sources                                                      */
/* ------------------------------------------------------------------ */

interface SourceHit extends SearchResult {
  source: string;
  score: number;
}

function freshnessDays(freshness?: string): number | null {
  switch (freshness) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 31;
    case "year":
      return 365;
    default:
      return null;
  }
}

function scoreHit(hit: SearchResult, terms: string[], windowDays: number | null): number {
  const title = hit.title.toLowerCase();
  const snippet = hit.snippet.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 3;
    if (snippet.includes(term)) score += 1;
  }
  if (hit.published && windowDays) {
    const age = Date.now() - new Date(hit.published).getTime();
    if (Number.isFinite(age) && age <= windowDays * 86_400_000) score += 4;
  }
  if (title.length > 3) score += 1;
  return score;
}

async function searchGoogleNews(
  query: string,
  limit: number,
  freshness?: string
): Promise<SearchResult[]> {
  const days = freshnessDays(freshness);
  const q = days ? `${query} when:${days}d` : query;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-AU&gl=AU&ceid=AU:en`;
  const res = await fetchRaw(url, { accept: "application/rss+xml,application/xml,text/xml" });
  if (res.status !== 200) return [];
  const items = res.text.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out: SearchResult[] = [];
  for (const item of items.slice(0, limit * 2)) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(item);
    const link = /<link>([\s\S]*?)<\/link>/i.exec(item);
    const date = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(item);
    const desc = /<description>([\s\S]*?)<\/description>/i.exec(item);
    const source = /<source\b[^>]*>([\s\S]*?)<\/source>/i.exec(item);
    if (!title || !link) continue;
    out.push({
      title: stripTags(title[1]),
      url: decodeEntities(link[1].trim()),
      snippet: desc ? stripTags(desc[1].split("<a ")[0]).slice(0, 320) : "",
      published: date ? new Date(date[1]).toISOString() : undefined,
      source: source ? stripTags(source[1]) : "Google News",
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*" +
    `&srlimit=${Math.min(limit, 20)}&srsearch=${encodeURIComponent(query)}`;
  const res = await fetchRaw(url, { accept: "application/json" });
  if (res.status !== 200) return [];
  const parsed = JSON.parse(res.text) as {
    query?: { search?: Array<{ title: string; snippet: string; timestamp: string }> };
  };
  const hits = parsed.query?.search ?? [];
  return hits.map((hit) => ({
    title: hit.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    snippet: stripTags(hit.snippet).slice(0, 320),
    published: hit.timestamp,
    source: "Wikipedia",
  }));
}

async function searchHackerNews(
  query: string,
  limit: number,
  freshness?: string
): Promise<SearchResult[]> {
  const days = freshnessDays(freshness);
  const filter = days
    ? `&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - days * 86400}`
    : "";
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
    query
  )}&tags=story&hitsPerPage=${Math.min(limit, 30)}${filter}`;
  const res = await fetchRaw(url, { accept: "application/json" });
  if (res.status !== 200) return [];
  const parsed = JSON.parse(res.text) as {
    hits?: Array<{
      title?: string;
      url?: string | null;
      story_text?: string | null;
      created_at?: string;
      objectID: string;
      points?: number;
    }>;
  };
  const hits = parsed.hits ?? [];
  return hits
    .filter((hit) => Boolean(hit.title))
    .map((hit) => ({
      title: hit.title as string,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: hit.story_text
        ? stripTags(hit.story_text).slice(0, 320)
        : `${hit.points ?? 0} points on Hacker News`, 
      published: hit.created_at,
      source: "Hacker News",
    }));
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  // The full HTML endpoint serves a bot challenge; the lite endpoint still
  // answers plain GETs. It wants a browser-shaped user agent, so use one here
  // and leave the honest DeepFetch UA on every other request.
  const browserUa =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=au-en`;
  const res = await fetchRaw(url, { accept: "text/html", userAgent: browserUa });
  if (res.status !== 200) return [];
  const rows = res.text.split(/<tr\b/i);
  const out: SearchResult[] = [];
  for (const row of rows) {
    const anchor = /<a\b[^>]*result-link[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!anchor) continue;
    const hrefMatch = /href=['"]([^'"]+)['"]/i.exec(anchor[0]);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1]);
    const uddg = /uddg=([^&]+)/.exec(href);
    const finalUrl = uddg ? decodeURIComponent(uddg[1]) : href.startsWith("//") ? `https:${href}` : href;
    const snippetMatch = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i.exec(row);
    out.push({
      title: stripTags(anchor[1]),
      url: finalUrl,
      snippet: snippetMatch ? stripTags(snippetMatch[1]).slice(0, 320) : "",
      source: "DuckDuckGo",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function search(
  query: string,
  options: { numResults?: number; freshness?: string } = {}
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Search query cannot be empty");
  const limit = Math.min(Math.max(options.numResults ?? 8, 1), 20);
  const windowDays = freshnessDays(options.freshness);

  const settled = await Promise.allSettled([
    searchDuckDuckGo(trimmed, limit),
    searchGoogleNews(trimmed, limit, options.freshness),
    searchHackerNews(trimmed, Math.ceil(limit / 2), options.freshness),
    searchWikipedia(trimmed, Math.ceil(limit / 2)),
  ]);

  const buckets: SourceHit[][] = settled.map((result) =>
    result.status === "fulfilled"
      ? result.value.map((hit) => ({
          ...hit,
          source: hit.source || "web",
          score: 0,
        }))
      : []
  );

  const terms = trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);

  for (const bucket of buckets) {
    for (const hit of bucket) hit.score = scoreHit(hit, terms, windowDays);
  }

  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const merged: SourceHit[] = [];
  const maxLen = Math.max(...buckets.map((b) => b.length), 0);
  for (let index = 0; index < maxLen; index += 1) {
    for (const bucket of buckets) {
      const hit = bucket[index];
      if (!hit) continue;
      const key = normaliseKey(hit.url);
      const titleKey = hit.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
      if (seen.has(key) || (titleKey.length > 20 && seenTitles.has(titleKey))) continue;
      seen.add(key);
      seenTitles.add(titleKey);
      merged.push(hit);
    }
  }

  const ranked = merged
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => b.hit.score - a.hit.score || a.index - b.index)
    .map((entry) => entry.hit)
    .slice(0, limit);

  return ranked.map(({ score: _score, ...rest }) => ({ ...rest, source: rest.source }));
}

/* ------------------------------------------------------------------ */
/* scrape                                                              */
/* ------------------------------------------------------------------ */

export async function scrape(
  url: string,
  options: { format?: "markdown" | "text"; includeLinks?: boolean; timeoutMs?: number } = {}
): Promise<ScrapeResult> {
  const res = await fetchWithRetry(url, { timeoutMs: options.timeoutMs });
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const type = res.contentType.toLowerCase();
  const truncated = res.text.length >= MAX_BYTES;

  if (type.includes("application/json")) {
    let pretty = res.text;
    try {
      pretty = JSON.stringify(JSON.parse(res.text), null, 2);
    } catch {
      /* keep raw */
    }
    return { url: res.finalUrl, title: res.finalUrl, markdown: pretty, truncated };
  }

  if (type.includes("pdf") || type.includes("octet-stream")) {
    throw new Error(
      `Unsupported content type (${res.contentType || "unknown"}). DeepFetch handles HTML, JSON and plain text.`
    );
  }

  if (type.startsWith("text/plain")) {
    return { url: res.finalUrl, title: res.finalUrl, markdown: res.text.trim(), truncated };
  }

  const parsed = htmlToMarkdown(res.text, res.finalUrl);
  const markdown = options.format === "text" ? stripTags(parsed.markdown).replace(/\n{3,}/g, "\n\n") : parsed.markdown;

  const result: ScrapeResult = {
    url: res.finalUrl,
    title: parsed.title || undefined,
    markdown,
    jsonLd: parsed.jsonLd.length > 0 ? parsed.jsonLd : undefined,
    truncated: truncated || undefined,
  };
  if (options.includeLinks) result.links = parsed.links.slice(0, 200);
  return result;
}

/* ------------------------------------------------------------------ */
/* robots.txt                                                          */
/* ------------------------------------------------------------------ */

interface RobotsRules {
  allow: string[];
  disallow: string[];
}

const robotsCache = new Map<string, RobotsRules>();

async function robotsFor(origin: string): Promise<RobotsRules | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
  try {
    const res = await fetchRaw(`${origin}/robots.txt`, { timeoutMs: 8000, accept: "text/plain" });
    if (res.status !== 200) {
      robotsCache.set(origin, { allow: [], disallow: [] });
      return { allow: [], disallow: [] };
    }
    const lines = res.text.split(/\r?\n/);
    const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
    let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
    let expectingAgents = false;
    for (const line of lines) {
      const clean = line.replace(/#.*$/, "").trim();
      if (!clean) continue;
      const [rawKey, ...rest] = clean.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        if (!current || !expectingAgents) {
          current = { agents: [], allow: [], disallow: [] };
          groups.push(current);
          expectingAgents = true;
        }
        current.agents.push(value.toLowerCase());
      } else if (key === "allow" && current) {
        current.allow.push(value);
        expectingAgents = false;
      } else if (key === "disallow" && current) {
        current.disallow.push(value);
        expectingAgents = false;
      }
    }
    const ours = groups.filter((group) =>
      group.agents.some((agent) => agent === "*" || agent.includes("deepfetch"))
    );
    const rules: RobotsRules = {
      allow: ours.flatMap((group) => group.allow).filter(Boolean),
      disallow: ours.flatMap((group) => group.disallow).filter(Boolean),
    };
    robotsCache.set(origin, rules);
    return rules;
  } catch {
    robotsCache.set(origin, { allow: [], disallow: [] });
    return { allow: [], disallow: [] };
  }
}

function robotsAllows(rules: RobotsRules, path: string): boolean {
  const matchLength = (patterns: string[]): number => {
    let best = -1;
    for (const pattern of patterns) {
      const cleaned = pattern.replace(/\*$/, "");
      if (cleaned === "") continue;
      if (path.startsWith(cleaned) && cleaned.length > best) best = cleaned.length;
    }
    return best;
  };
  const allowLength = matchLength(rules.allow);
  const disallowLength = matchLength(rules.disallow);
  if (disallowLength === -1) return true;
  return allowLength >= disallowLength;
}

/* ------------------------------------------------------------------ */
/* crawl                                                               */
/* ------------------------------------------------------------------ */

export async function crawl(
  url: string,
  options: {
    maxPages?: number;
    maxDepth?: number;
    includePaths?: string[];
    timeoutMs?: number;
  } = {}
): Promise<CrawlResult> {
  const start = assertPublicUrl(url);
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 25);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 1, 0), 3);
  const includePaths = (options.includePaths ?? []).filter(Boolean);
  const origin = start.origin;
  const allowedHosts = new Set<string>([start.host]);

  const rules = await robotsFor(origin);
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];
  const visited = new Set<string>();
  const pages: CrawlResult["pages"] = [];
  const skipped: Array<{ url: string; reason: string }> = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const batch = queue.splice(0, Math.min(3, maxPages - pages.length));
    const results = await Promise.all(
      batch.map(async (item) => {
        const key = normaliseKey(item.url);
        if (visited.has(key)) return null;
        visited.add(key);
        const parsedUrl = new URL(item.url);
        if (!allowedHosts.has(parsedUrl.host)) {
          skipped.push({ url: item.url, reason: "offsite" });
          return null;
        }
        if (includePaths.length > 0 && !includePaths.some((p) => parsedUrl.pathname.startsWith(p))) {
          skipped.push({ url: item.url, reason: "outside include_paths" });
          return null;
        }
        if (rules && !robotsAllows(rules, parsedUrl.pathname)) {
          skipped.push({ url: item.url, reason: "robots.txt disallow" });
          return null;
        }
        try {
          const page = await scrape(item.url, { timeoutMs: options.timeoutMs, includeLinks: true });
          return { ...page, depth: item.depth };
        } catch (err) {
          skipped.push({
            url: item.url,
            reason: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      })
    );

    for (const page of results) {
      if (!page) continue;
      try {
        allowedHosts.add(new URL(page.url).host);
      } catch {
        /* keep existing hosts */
      }
      if (page.markdown.trim().length < 50) {
        skipped.push({ url: page.url, reason: "empty content" });
        continue;
      }
      pages.push({
        url: page.url,
        title: page.title,
        markdown: page.markdown.slice(0, 40_000),
      });
      if (pages.length >= maxPages) break;
      if (page.depth >= maxDepth) continue;
      const found = new Set(page.links ?? []);
      for (const link of found) {
        const key = normaliseKey(link);
        if (visited.has(key)) continue;
        try {
          const candidate = new URL(link);
          if (!allowedHosts.has(candidate.host)) continue;
          if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|mp4|mp3|css|js|ico|woff2?)$/i.test(candidate.pathname)) continue;
          if (candidate.pathname === new URL(page.url).pathname) continue;
          queue.push({ url: candidate.toString(), depth: page.depth + 1 });
        } catch {
          /* skip malformed */
        }
      }
    }

    if (pages.length < maxPages) await sleep(150);
  }

  return {
    url: start.toString(),
    pages,
    skipped: skipped.length > 0 ? skipped.slice(0, 20) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* extract                                                             */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "what",
  "when",
  "where",
  "which",
  "find",
  "extract",
  "return",
  "give",
  "list",
  "get",
  "all",
  "any",
  "into",
  "about",
  "their",
  "there",
  "have",
  "has",
  "are",
  "was",
  "were",
  "you",
  "your",
  "please",
]);

function keywordsOf(instruction: string): string[] {
  return Array.from(
    new Set(
      instruction
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    )
  ).slice(0, 24);
}

function heuristicExtract(
  text: string,
  instruction: string,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const keywords = keywordsOf(instruction);
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30 && sentence.length < 600);

  const scored = sentences
    .map((sentence, index) => {
      const lower = sentence.toLowerCase();
      const score = keywords.reduce((total, keyword) => (lower.includes(keyword) ? total + 1 : total), 0);
      return { sentence, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 12)
    .map((entry) => entry.sentence);

  return {
    ...extra,
    instruction,
    keywords,
    matches: scored,
    note:
      scored.length === 0
        ? "No sentence matched the instruction keywords. Pass content directly, or set DEEPFETCH_LLM_API_KEY to run the instruction through a model."
        : "Heuristic mode: verbatim sentences ranked by keyword overlap. Set DEEPFETCH_LLM_API_KEY for model-executed extraction.",
  };
}

async function llmExtract(text: string, instruction: string): Promise<Record<string, unknown>> {
  const key = process.env.DEEPFETCH_LLM_API_KEY || "";
  const base = (process.env.DEEPFETCH_LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.DEEPFETCH_LLM_MODEL || "deepseek-chat";
  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract structured data from web pages. Reply with a single JSON object only, no prose, no code fences. Use null for fields the page does not state. Never invent values.",
      },
      {
        role: "user",
        content: `Instruction: ${instruction}\n\nPage content:\n${text.slice(0, 24_000)}`,
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM endpoint returned HTTP ${res.status}`);
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const cleaned = content.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return { raw: content };
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function extract(
  urlOrContent: string,
  instruction: string,
  isUrl = true
): Promise<ExtractResult> {
  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) throw new Error("Instruction cannot be empty");

  let text = urlOrContent;
  let resolvedUrl: string | undefined;
  let extra: Record<string, unknown> = {};

  if (isUrl) {
    const page = await scrape(urlOrContent, { includeLinks: false });
    text = page.markdown;
    resolvedUrl = page.url;
    extra = {
      title: page.title ?? null,
      ...(page.jsonLd ? { jsonLd: page.jsonLd } : {}),
    };
  }

  if (!text.trim()) {
    throw new Error("Nothing to extract: the page produced no readable text");
  }

  if (process.env.DEEPFETCH_LLM_API_KEY) {
    const data = await llmExtract(text, trimmedInstruction);
    return { url: resolvedUrl, mode: "llm", data };
  }

  return {
    url: resolvedUrl,
    mode: "heuristic",
    data: heuristicExtract(text, trimmedInstruction, extra),
  };
}
