import { extract } from "../lib/client.js";

export const extractTool = {
  name: "deepfetch_extract",
  description:
    "Extract structured data from a URL (or already-scraped content) using a natural language instruction. Example: \"Extract the product name, price, and rating\".",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL to extract from (preferred)",
      },
      content: {
        type: "string",
        description: "Already-scraped text/markdown if you do not want to re-fetch",
      },
      instruction: {
        type: "string",
        description: "Natural language description of what to extract",
      },
    },
    required: ["instruction"],
  },
  handler: async (args: {
    url?: string;
    content?: string;
    instruction: string;
  }) => {
    if (!args.url && !args.content) {
      throw new Error("Either 'url' or 'content' must be provided");
    }

    const isUrl = Boolean(args.url);
    const result = await extract(
      (args.url || args.content) as string,
      args.instruction,
      isUrl
    );

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
