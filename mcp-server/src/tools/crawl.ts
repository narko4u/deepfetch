import { crawl } from "../lib/client.js";

export const crawlTool = {
  name: "deepfetch_crawl",
  description:
    "Crawl a website or a section of it. Returns clean content from multiple pages. Use when you need several related pages (docs, blog, product catalog).",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Starting URL",
      },
      max_pages: {
        type: "number",
        description: "Maximum number of pages to crawl (default 10)",
        default: 10,
      },
      max_depth: {
        type: "number",
        description: "Maximum link depth from the start URL (default 2)",
        default: 2,
      },
      include_paths: {
        type: "array",
        items: { type: "string" },
        description: "Optional path prefixes to restrict the crawl (e.g. [\"/docs\", \"/blog\"])",
      },
    },
    required: ["url"],
  },
  handler: async (args: {
    url: string;
    max_pages?: number;
    max_depth?: number;
    include_paths?: string[];
  }) => {
    const result = await crawl(args.url, {
      maxPages: args.max_pages,
      maxDepth: args.max_depth,
      includePaths: args.include_paths,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};
