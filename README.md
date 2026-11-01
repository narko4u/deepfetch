# DeepFetch

[![build](https://github.com/narko4u/deepfetch/actions/workflows/build.yml/badge.svg)](https://github.com/narko4u/deepfetch/actions/workflows/build.yml)

High-quality web research, clean scraping, site crawling, and structured data extraction for **Grok Build**.

## Features (v0.1)

| Tool | Description |
|------|-------------|
| `deepfetch_search` | Web search with ranking & freshness |
| `deepfetch_scrape` | Clean markdown / text from any URL |
| `deepfetch_crawl` | Crawl a site or section with limits |
| `deepfetch_extract` | Structured extraction via natural language instructions |

## Status: v0.1.0, backend not implemented

This release ships the plugin shell, the MCP server, the tool schemas and the skills. The
transport layer in `mcp-server/src/lib/client.ts` is still a stub: every tool returns a
placeholder response. Nothing here searches, scrapes, crawls or extracts yet.

What works today: the server builds on CI, starts, lists its four tools and validates their
arguments. What does not: the actual fetching. Wire `client.ts` to a real backend before
listing this anywhere as a working tool.

## Install in Grok Build

```bash
# Add the marketplace (once)
grok plugin marketplace add narko4u/deepfetch

# Install the plugin
grok plugin install deepfetch --trust
```

Or from inside a Grok Build session:

```
/marketplace
```

## Configuration

Set your API key (required for paid / higher limits):

```bash
export DEEPFETCH_API_KEY="your-key-here"
```

You can also put it in `~/.grok/config.toml` or pass it via the environment when starting Grok.

## Development

```bash
cd mcp-server
npm install
npm run build
npm run dev          # watch mode
```

## Skills

- **deep-research** – Multi-step research workflow
- **scrape-page** – Single page clean extraction
- **extract-data** – Structured field extraction

## License

MIT
