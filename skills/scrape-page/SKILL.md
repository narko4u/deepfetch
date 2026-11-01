---
name: scrape-page
description: Cleanly extract the main content of a web page as markdown or plain text. Use when the user pastes a URL or asks to read / summarize a specific page.
when-to-use: scrape, read this page, summarize url, extract content from
---

# Scrape Page Skill

When the user provides a URL or asks to read a specific page:

1. Call `deepfetch_scrape` with the URL.
2. Request `format: "markdown"` unless the user specifically wants plain text or JSON.
3. If the page is very long, focus on the main content and summarize the rest.
4. Always return the original URL so the user can verify.
