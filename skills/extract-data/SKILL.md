---
name: extract-data
description: Extract structured fields (price, title, specs, dates, etc.) from a page or already-scraped content using natural language instructions.
when-to-use: extract, pull out, get the price, structured data, fields from page
---

# Extract Data Skill

Use `deepfetch_extract` when you need specific fields rather than the full page content.

Examples of good instructions:
- "Extract the product name, current price, original price, and rating"
- "Get the job title, company, location, and salary range"
- "Return the article title, author, publish date, and a 2-sentence summary"

Prefer a clear natural-language instruction over a rigid JSON schema when possible. The tool will return structured data.
