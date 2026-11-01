#!/usr/bin/env node
/**
 * DeepFetch MCP Server
 * Exposes web research, scraping, crawling, and extraction tools to Grok Build.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { searchTool } from "./tools/search.js";
import { scrapeTool } from "./tools/scrape.js";
import { crawlTool } from "./tools/crawl.js";
import { extractTool } from "./tools/extract.js";

const tools = [searchTool, scrapeTool, crawlTool, extractTool];

const server = new Server(
  {
    name: "deepfetch",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  try {
    // @ts-ignore – handlers are typed loosely for the stub
    const result = await tool.handler(args || {});
    return result;
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err.message || String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DeepFetch MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
