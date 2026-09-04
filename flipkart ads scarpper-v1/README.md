# Flipkart ads scraper (`flipkart-search-term-scrapper.exe`)

Scrapes Flipkart **search-result pages** for search terms supplied by the
backend, reporting the sponsored and organic products found on page one.

Part of the **Flipkart** bundle, alongside
[`flipkart scarpper rating-v1/`](../flipkart%20scarpper%20rating-v1/). Normally
launched by `VentaHubAgentFlipkart.exe` rather than run by hand — see the
[root README](../README.md).

**For a full step-by-step walkthrough see [HOW_TO_RUN.md](HOW_TO_RUN.md).**
This file is the quick reference.

## Run it

```bash
npm install
npm run dev          # from source
npm run mock         # local mock backend
npm run build:exe    # -> dist/flipkart-search-term-scrapper.exe
```

First run opens a setup page for your email + profile IDs, then Flipkart for a
one-time sign-in. Stored in `user-settings.json` inside the Chrome profile.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `QUERIES_API_URL` | `https://domventas.info/backend/api/v1/scrapper/flipkart/queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `https://domventas.info/backend/api/v1/scrapper/flipkart/results` | Where to post results |
| `API_TOKEN` | *(baked in by CI)* | Bearer token; must match the backend |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\FlipkartSearchTermScrapper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_SHORT_CODES` | *(all)* | Comma-separated filter, e.g. `FKIN` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_FLIPKART_DOMAIN` | `www.flipkart.com` | Domain used for the first-run login |

These defaults come from `src/embedded.ts`, with the token injected at build
time from the `SCRAPPER_API_TOKEN` secret. The agent still overrides all three
from the backend's assignment when it launches this scraper — environment
always beats baked-in.

## Marketplaces

Defined in [`src/marketplaces.ts`](src/marketplaces.ts):

| Code | Storefront |
| --- | --- |
| `FKIN` | www.flipkart.com (pincode 110001) |
| `FKGR` | grocery |
| `FKWS` | wholesale |

## Output markers

`[OK]` / `[FAIL]` per query and a final `[DONE]`, parsed by the agent to
classify the run. Don't change them without updating
`ventahub-agent/src/spawn.ts`.
