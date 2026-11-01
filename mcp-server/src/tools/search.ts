import { search } from "../lib/client.js";

export const searchTool = {
  name: "deepfetch_search",
  description:
    "Search the web for high-quality, relevant results. Returns titles, URLs, and snippets. Prefer this tool for research questions.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      num_results: {
        type: "number",
        description: "Number of results to return (default 8, max 20)",
        default: 8,
      },
      freshness: {
        type: "string",
        description: "Optional freshness filter: day, week, month, year",
        enum: ["day", "week", "month", "year"],
      },
    },
    required: ["query"],
  },
  handler: async (args: { query: string; num_results?: number; freshness?: string }) => {
    const results = await search(args.query, {
      numResults: args.num_results,
      freshness: args.freshness,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ results }, null, 2),
        },
      ],
    };
  },
};
