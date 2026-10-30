# Amazon ads scraper (`search-term-scrapper.exe`)

Scrapes Amazon **search-result pages** for a list of search terms supplied by
the backend, and reports the competing products it finds on page one.

It reads the VentaWiz search-term queue (`GET /v1/scrapper/search-term-queries`)
for the configured **store ids**, and for each term posts up to **5 sponsored +
5 organic** grid products, in page order, to `POST /v1/scrapper/search-term-results`.
The backend stores sponsored in `comp1..5` and organic in `org1..5` and never
mixes them. Sponsored Brands banners are not counted (`INCLUDE_SPONSORED_BRANDS`
is off by default). A search with no results is still posted, and a `409`
("already stored today") counts as success.

Part of the **Amazon** bundle, alongside
[`rating-scraper/`](../rating-scraper/). Normally launched by
the VentaWiz agent rather than run by hand — see the
[root README](../README.md).

For a step-by-step first run, see [HOW_TO_RUN.md](HOW_TO_RUN.md).

## Run it

```bash
npm install
npm run dev          # from source
npm run build:exe    # -> dist/search-term-scrapper.exe
```

On a standalone first run it opens a setup page for your email + VentaWiz
**store IDs** (whole numbers), then Amazon for a one-time sign-in. When the
agent launches it with `SCRAPE_STORE_IDS`, the setup page is skipped. Those are stored in `user-settings.json` inside the
Chrome profile directory and reused on every later run.

## Service account

There is no shared token. Every VentaWiz call is authenticated with a
**VentaWiz service account** — `VW_CLIENT_ID` (`svc_…`) + `VW_CLIENT_SECRET`
(`vws_…`). [`src/api/auth.ts`](src/api/auth.ts) exchanges them for a
short-lived bearer token at `POST {VW_AUTH_URL}/v1/token` (OAuth
`client_credentials`), caches it until 60 s before expiry, and re-exchanges
once on a 401. When the agent launches this scraper it passes all three
variables; for a standalone run put them in `.env`. Missing credentials print
`[FAIL]` + `[DONE]` and the run exits without opening Chrome; a rejected
id/secret reads `client id/secret rejected — check the service account`, and a
403 reads `service account lacks scrapper:run`.

A VentaWiz admin creates the account in VentaWiz-Auth —
`POST /v1/service-principals?application=ventawiz` (the secret is shown **once**) — and grants it
`scrapper:run` with `POST /v1/grants` (`"application": "ventawiz"`), for every store or per store. See the
[root README](../README.md#2-credentials--ventawiz-service-accounts).

## Configuration

All settings are environment variables, overridable via a `.env` file. When the
agent launches this scraper it sets the API URLs, auth URL, service account, store ids, marketplace,
profile dir and browser visibility itself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (real host baked in at build time) | VentaWiz server root, no `/api` prefix |
| `QUERIES_API_URL` | `<root>/v1/scrapper/search-term-queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `<root>/v1/scrapper/search-term-results` | Where to post results |
| `VW_AUTH_URL` | `http://localhost:8100` (real host baked in at build time) | VentaWiz auth service root; token exchange is `POST /v1/token` |
| `VW_CLIENT_ID` | *(set by the agent)* | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | *(set by the agent)* | VentaWiz service account secret, `vws_…` — never commit it |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\SearchTermScrapper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated VentaWiz store ids, e.g. `13,16` |
| `SCRAPE_MARKETPLACE` | `amazon` | Sent as `marketplace=` on the queue request |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `AZUS,AZUK` |
| `INCLUDE_SPONSORED_BRANDS` | `0` | `1` also counts Sponsored Brands banner tiles (VentaWiz says don't) |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `14000` | Pause between queries |
| `DEFAULT_AMAZON_DOMAIN` | `www.amazon.in` | Domain used for the first-run login |

## Marketplaces

Short codes are defined in [`src/marketplaces.ts`](src/marketplaces.ts):

```
AZIN AZUS AZUK AZAU AZCA AZDE AZFR AZIT
AZES AZNL AZBE AZMX AZPO AZSW AZAE AZSA
```

An unrecognised code raises `Unknown short_code` rather than silently scraping
the wrong storefront. Each queue item carries its own `short_code`. To add
one, add it here and have the backend send it.

## Output markers

Progress is printed as `[OK]` / `[FAIL]` per query, with a final `[DONE]`. The
agent counts these to classify a run, so **don't change them** without updating
`ventahub-agent/src/spawn.ts`.
