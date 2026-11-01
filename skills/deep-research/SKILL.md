---
name: deep-research
description: Perform thorough, multi-source web research using DeepFetch. Use when the user needs current information, comparisons, market data, or synthesized answers from the live web.
when-to-use: research, current events, compare products, find latest, web research, investigate topic
---

# Deep Research Skill

When the user asks for research, current information, or multi-source synthesis:

1. **Search first**  
   Call `deepfetch_search` with a clear, focused query. Request 8–12 results when possible.

2. **Select best sources**  
   Prefer recent, high-authority, primary sources. Skip low-quality or duplicate content.

3. **Scrape or crawl**  
   Use `deepfetch_scrape` for individual high-value pages.  
   Use `deepfetch_crawl` when you need multiple pages from the same site (docs, blog series, product pages).

4. **Extract structured data** when needed  
   Call `deepfetch_extract` with a clear natural-language instruction or schema.

5. **Synthesize & cite**  
   Always include the source URLs in your final answer. Prefer quoting key facts over paraphrasing when accuracy matters.

Prefer depth over breadth. It is better to deeply process 4–6 excellent sources than to skim 20 mediocre ones.
