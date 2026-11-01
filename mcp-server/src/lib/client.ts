/**
 * DeepFetch API client
 * 
 * This is a stub. Replace the implementations with calls to your real backend
 * (self-hosted scraper, Firecrawl, Browserbase, Tavily, Exa, etc.).
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

export interface ScrapeResult {
  url: string;
  title?: string;
  markdown: string;
  links?: string[];
}

export interface CrawlResult {
  url: string;
  pages: Array<{
    url: string;
    title?: string;
    markdown: string;
  }>;
}

export interface ExtractResult {
  url?: string;
  data: Record<string, unknown>;
}

const API_KEY = process.env.DEEPFETCH_API_KEY || "";
const BASE_URL = process.env.DEEPFETCH_API_URL || "https://api.deepfetch.example"; // change this

async function request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  // TODO: Replace with real HTTP call once you have a backend
  // For now we return clear stub responses so the MCP server starts cleanly.

  if (!API_KEY) {
    console.error("[DeepFetch] Warning: DEEPFETCH_API_KEY is not set");
  }

  // Simulated delay
  await new Promise((r) => setTimeout(r, 150));

  // Stub responses – replace these with real API calls
  if (path === "/search") {
    return {
      results: [
        {
          title: `Stub result for: ${body.query}`,
          url: "https://example.com/stub",
          snippet: "This is a placeholder. Wire up your real search backend in src/lib/client.ts",
        },
      ],
    } as T;
  }

  if (path === "/scrape") {
    return {
      url: body.url,
      title: "Stub Page Title",
      markdown: `# Stub content\n\nYou requested: ${body.url}\n\nReplace this with a real scraper.`,
      links: [],
    } as T;
  }

  if (path === "/crawl") {
    return {
      url: body.url,
      pages: [
        {
          url: body.url as string,
          title: "Stub crawl page",
          markdown: "Stub crawl content. Implement real crawling in client.ts",
        },
      ],
    } as T;
  }

  if (path === "/extract") {
    return {
      url: body.url,
      data: {
        note: "Stub extraction result",
        instruction: body.instruction,
      },
    } as T;
  }

  throw new Error(`Unknown path: ${path}`);
}

export async function search(
  query: string,
  options: { numResults?: number; freshness?: string } = {}
): Promise<SearchResult[]> {
  const res = await request<{ results: SearchResult[] }>("/search", {
    query,
    num_results: options.numResults ?? 8,
    freshness: options.freshness,
  });
  return res.results;
}

export async function scrape(
  url: string,
  options: { format?: "markdown" | "text"; includeLinks?: boolean } = {}
): Promise<ScrapeResult> {
  return request<ScrapeResult>("/scrape", {
    url,
    format: options.format ?? "markdown",
    include_links: options.includeLinks ?? false,
  });
}

export async function crawl(
  url: string,
  options: { maxPages?: number; maxDepth?: number; includePaths?: string[] } = {}
): Promise<CrawlResult> {
  return request<CrawlResult>("/crawl", {
    url,
    max_pages: options.maxPages ?? 10,
    max_depth: options.maxDepth ?? 2,
    include_paths: options.includePaths,
  });
}

export async function extract(
  urlOrContent: string,
  instruction: string,
  isUrl = true
): Promise<ExtractResult> {
  return request<ExtractResult>("/extract", {
    [isUrl ? "url" : "content"]: urlOrContent,
    instruction,
  });
}
