# VH-Scrappers

Monorepo housing Dom Ventas' web scrapers. Each scraper lives in its own
self-contained subdirectory with its own dependencies and configuration.

## Scrapers

| Folder | Description | Status |
| --- | --- | --- |
| [`amazon-ads-scraper/`](amazon-ads-scraper/) | Scrapes Amazon Ads data (Playwright + TypeScript). | Active |
| [`rating-scraper/`](rating-scraper/) | Scrapes product ratings. | Planned |

## Getting started

Each scraper is independent. Change into its folder and follow its own README:

```bash
cd amazon-ads-scraper
npm install
# see amazon-ads-scraper/HOW_TO_RUN.md
```
