import { scrape } from "../lib/client.js";

export const scrapeTool = {
  name: "deepfetch_scrape",
  description:
    "Fetch a single URL and return clean main content as markdown (or plain text). Best for reading articles, docs, product pages, etc.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full URL to scrape",
      },
      format: {
        type: "string",
        description: "Output format",
        enum: ["markdown", "text"],
        default: "markdown",
      },
      include_links: {
        type: "boolean",
        description: "Whether to also return extracted links",
        default: false,
      },
    },
    required: ["url"],
  },
  handler: async (args: {
    url: string;
    format?: "markdown" | "text";
    include_links?: boolean;
  }) => {
    const result = await scrape(args.url, {
      format: args.format,
      includeLinks: args.include_links,
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
