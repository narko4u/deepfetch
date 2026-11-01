# DeepFetch

[![build](https://github.com/narko4u/deepfetch/actions/workflows/build.yml/badge.svg)](https://github.com/narko4u/deepfetch/actions/workflows/build.yml)

Web research for **Grok Build**: search, clean scraping, site crawling and structured extraction, exposed as four MCP tools.

No vendor account. No API key required. Search fans out across public endpoints and merges whatever answers. Scraping and crawling run in process with zero runtime dependencies beyond Node globals.

## Tools

| Tool | What it does |
|------|--------------|
| `deepfetch_search` | Web search with ranking and freshness, merged across several public sources |
| `deepfetch_scrape` | Clean markdown or plain text from a single URL |
| `deepfetch_crawl` | Same-site crawl with page, depth and path limits, robots.txt honoured |
| `deepfetch_extract` | Structured data from a URL or supplied text, by natural language instruction |

### `deepfetch_search`

```json
{ "query": "Binance hack North Korea", "num_results": 8, "freshness": "week" }
```

Returns `{ results: [ { title, url, snippet, published, source } ] }`. Sources currently include DuckDuckGo, Google News, Hacker News and Wikipedia. Results are deduplicated by URL and title, then ranked by term overlap in title and snippet, with a bonus for results inside the freshness window.

### `deepfetch_scrape`

```json
{ "url": "https://example.com/article", "format": "markdown", "include_links": true }
```

Returns `{ url, title, markdown, links, jsonLd, truncated }`. Content selection prefers `<article>` or `<main>` when it carries most of the page text, strips scripts, styles, navigation, footers and forms, then converts headings, lists, tables, code blocks, links and images to markdown.

### `deepfetch_crawl`

```json
{ "url": "https://docs.example.com", "max_pages": 10, "max_depth": 2, "include_paths": ["/docs"] }
```

Same-host only, follows the post-redirect host, skips assets and duplicate paths, and stops on robots.txt disallow. Caps: 25 pages, depth 3.

### `deepfetch_extract`

```json
{ "url": "https://example.com/product", "instruction": "price, availability and shipping cost" }
```

Two modes:

- **Heuristic** (default, no key): returns the page title, any JSON-LD blocks and verbatim sentences ranked by keyword overlap. Honest about what it is, never invents a value.
- **Model** (set `DEEPFETCH_LLM_API_KEY`): sends the instruction and page text to any OpenAI-compatible chat endpoint and returns parsed JSON.

## Install

Grok Build loads plugins from `~/.grok/plugins/`, a project `.grok/plugins/` directory, an installed marketplace, or any path given with `--plugin-dir`.

```bash
git clone https://github.com/narko4u/deepfetch
cd deepfetch/mcp-server
npm install
npm run build
```

Then pick one:

- copy or symlink the repo into `~/.grok/plugins/deepfetch` and enable it from `/plugins`
- or launch Grok Build with `--plugin-dir /path/to/deepfetch`
- or add this repo as a marketplace source and install from `/marketplace`

The server is declared in `.mcp.json`, so Claude Code compatible clients pick it up as well. To run it on its own:

```bash
node mcp-server/dist/index.js
```

The repo also carries `.claude-plugin/marketplace.json` in the Claude Code marketplace format, which Grok Build reads.

## Configuration

All optional. Nothing is required to run.

| Variable | Default | Purpose |
|---|---|---|
| `DEEPFETCH_TIMEOUT_MS` | `20000` | Per-request timeout |
| `DEEPFETCH_MAX_BYTES` | `3000000` | Response size cap before parsing |
| `DEEPFETCH_USER_AGENT` | `DeepFetch/0.2.0 (+repo url)` | Identify yourself differently if you run this at scale |
| `DEEPFETCH_DUALSTACK` | unset | Set to `1` to keep Node dual-stack connect behaviour. By default IPv4 is forced, which fixes connect timeouts on networks with a broken IPv6 route |
| `DEEPFETCH_LLM_API_KEY` | unset | Enables model-backed `deepfetch_extract` |
| `DEEPFETCH_LLM_BASE_URL` | `https://api.deepseek.com/v1` | Any OpenAI-compatible base URL |
| `DEEPFETCH_LLM_MODEL` | `deepseek-chat` | Model name for extraction |

## Behaviour and limits

- **Robots**: the crawler reads robots.txt per origin, honours `Disallow` for `*` and for `DeepFetch`, and applies longest-match with `Allow` winning ties.
- **SSRF guard**: every request is parsed and rejected if it targets loopback, link-local, private ranges, `.internal` or `.local`. This is a fetch tool, not a proxy into your network.
- **Politeness**: crawl batches three requests at a time with a short gap, and only follows same-host links.
- **No JavaScript**: pages that render entirely client-side will come back thin. Add a headless browser if you need that.
- **No PDFs or binary documents**: HTML, JSON and plain text only, with a clear error otherwise.
- **Public sources move**: if one search backend starts refusing traffic the others still answer, but result mix will change. That is a feature of being keyless, not a bug.

## Development

```bash
cd mcp-server
npm install
npm run build
npm run dev     # watch mode
```

CI runs `npm install`, `tsc`, asserts `dist/index.js` exists, then starts the server and requires all four tools over stdio.

## Skills

- **deep-research**: multi-step research workflow
- **scrape-page**: single page clean extraction
- **extract-data**: structured field extraction

## Licence

MIT. Copyright (c) 2026 Security Division, Empire Labs Pty Ltd.
