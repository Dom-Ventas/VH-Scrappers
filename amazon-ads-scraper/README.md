# Amazon ads scraper (`search-term-scrapper.exe`)

Scrapes Amazon **search-result pages** for a list of search terms supplied by
the backend, and reports the competing products it finds on page one.

For each query it sends back up to **5 sponsored + 5 organic** products. Both
buckets matter: the backend fills `comp1..5` sponsored-first (backfilled with
organic) and `org1..5` separately, so sending sponsored-only leaves the organic
columns null and fails its 5-competitor check.

Part of the **Amazon** bundle, alongside
[`rating-scraper/`](../rating-scraper/). Normally launched by
`VentaHubAgent.exe` rather than run by hand — see the
[root README](../README.md).

For a step-by-step first run, see [HOW_TO_RUN.md](HOW_TO_RUN.md).

## Run it

```bash
npm install
npm run dev          # from source
npm run build:exe    # -> dist/search-term-scrapper.exe
```

On first run it opens a setup page for your email + profile IDs, then Amazon
for a one-time sign-in. Those are stored in `user-settings.json` inside the
Chrome profile directory and reused on every later run.

## Configuration

All settings are environment variables, overridable via a `.env` file. When the
agent launches this scraper it sets the first six itself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `QUERIES_API_URL` | `…/backend/api/v1/scrapper/queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `…/backend/api/v1/scrapper/results` | Where to post results |
| `API_TOKEN` | *(baked in by CI)* | Bearer token; must match the backend |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\SearchTermScrapper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_SHORT_CODES` | *(all)* | Comma-separated filter, e.g. `AZUS,AZUK` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_AMAZON_DOMAIN` | `www.amazon.in` | Domain used for the first-run login |

## Marketplaces

Short codes are defined in [`src/marketplaces.ts`](src/marketplaces.ts):

```
AZIN AZUS AZUK AZAU AZCA AZDE AZFR AZIT
AZES AZNL AZBE AZMX AZPO AZSW AZAE AZSA
```

An unrecognised code raises `Unknown short_code` rather than silently scraping
the wrong storefront. To add one, add it here and have the backend send it.

## Output markers

Progress is printed as `[OK]` / `[FAIL]` per query, with a final `[DONE]`. The
agent counts these to classify a run, so **don't change them** without updating
`ventahub-agent/src/spawn.ts`.
