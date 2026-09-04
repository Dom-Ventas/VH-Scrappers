# noon ads scraper (`noon-search-term-scrapper.exe`)

Scrapes noon **search-result pages** for search terms supplied by the backend,
reporting the sponsored and organic products found on page one.

Part of the **noon** bundle, alongside
[`noon review scrapper-v1/`](../noon%20review%20scrapper-v1/). Normally launched
by `VentaHubAgentNoon.exe` rather than run by hand — see the
[root README](../README.md).

**For a full step-by-step walkthrough see [HOW_TO_RUN.md](HOW_TO_RUN.md).**
This file is the quick reference.

## Locales matter

Unlike Flipkart's single storefront, noon serves every country from one host
under a locale path segment — `noon.com/uae-en/search/?q=…` vs
`noon.com/saudi-en/…`. Get it wrong and you silently scrape another country's
catalogue **and currency**, so the locale is resolved from the short code rather
than guessed.

## Run it

```bash
npm install
npm run dev          # from source
npm run mock         # local mock backend
npm run build:exe    # -> dist/noon-search-term-scrapper.exe
```

First run opens a setup page for your email + profile IDs, then the noon
storefront for a one-time sign-in.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `QUERIES_API_URL` | *(empty)* | Where to fetch search terms |
| `RESULTS_API_URL` | *(empty)* | Where to post results |
| `API_TOKEN` | — | Bearer token; must match the backend |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\NoonSearchTermScrapper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_SHORT_CODES` | *(all)* | Comma-separated filter, e.g. `NNAE` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_NOON_DOMAIN` | `www.noon.com` | Host used for the first-run login |
| `DEFAULT_NOON_LOCALE` | `uae-en` | Storefront opened on first run |

The endpoint defaults are **intentionally blank** — this scraper is meant to be
launched by the agent, which supplies both URLs from the backend's assignment.

## Marketplaces

Defined in [`src/marketplaces.ts`](src/marketplaces.ts):

| Code | Locale | Currency |
| --- | --- | --- |
| `NNAE` | `uae-en` | AED |
| `NNSA` | `saudi-en` | SAR |

An unknown code raises an error naming the valid codes.

## Output markers

`[OK]` / `[FAIL]` per query and a final `[DONE]`, parsed by the agent to
classify the run.
