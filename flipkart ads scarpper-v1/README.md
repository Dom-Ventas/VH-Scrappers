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

First run opens a setup page for your email + VentaWiz **store IDs** (whole
numbers), then Flipkart for a one-time sign-in. Stored in `user-settings.json`
inside the Chrome profile as `{ emailId, storeIds, firstRunCompletedAt }`. A
legacy file holding only VentaHub `profileIds` is ignored and the form shown
again. When the agent passes `SCRAPE_STORE_IDS` the form is skipped.

## Backend (VentaWiz)

One pass per run: fetch the whole queue for all store ids, then scrape and post
each search term.

- `GET /v1/scrapper/search-term-queries?store_id=13&store_id=16&marketplace=flipkart&page=1&limit=100`
  → `{ items: [{ store_id, short_code, search_term }], pagination }`, followed to
  the last page; store ids are sent 50 per request at most.
- `POST /v1/scrapper/search-term-results`, one per search:
  `{ store_id, search_term, products: [{ position, mp_product_id, is_sponsored,
  price, rating, review_count, delivery_days, title }] }` — up to 5 sponsored +
  5 organic in page order. `mp_product_id` is the Flipkart PID; `delivery_days`
  is always `null` (Flipkart's results page shows none). An empty `products` is
  still posted. A **409** (already stored today) is logged as `[OK]`.

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

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (from `src/embedded.ts`) | VentaWiz server root |
| `QUERIES_API_URL` | `<VH_API_ROOT>/v1/scrapper/search-term-queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `<VH_API_ROOT>/v1/scrapper/search-term-results` | Where to post results |
| `SCRAPE_STORE_IDS` | *(first-run store IDs)* | Comma-separated store ids; set by the agent |
| `SCRAPE_MARKETPLACE` | `flipkart` | Sent as `marketplace=` on the queue request |
| `VW_AUTH_URL` | `http://localhost:8100` (real host baked in at build time) | VentaWiz auth service root; token exchange is `POST /v1/token` |
| `VW_CLIENT_ID` | *(set by the agent)* | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | *(set by the agent)* | VentaWiz service account secret, `vws_…` — never commit it |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\FlipkartSearchTermScrapper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_SHORT_CODES` | *(all)* | Comma-separated filter, e.g. `FKIN` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_FLIPKART_DOMAIN` | `www.flipkart.com` | Domain used for the first-run login |

These defaults come from `src/embedded.ts` (hosts only — no secret is baked
in). The agent overrides the URLs, auth URL, service account, store ids and
marketplace when it launches this scraper — environment always beats baked-in.

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

`[SPONSORED]` lines are diagnostics, not run-state markers. They appear only
when a page came back with **zero** sponsored cards on the first pass. The
scraper then waits 1.5 s and re-checks every card, because Flipkart attaches
its ad markup (`data-tkid="ADVIEW_…"`, the card's own `en_…` tracking id)
client-side and it can trail the product grid on a slow laptop. A pass that
runs inside that window sees every tile as organic, and the backend then fills
`comp1..5` and `org1..5` from the same five organic products — the duplicated
rows in Data Vault's Scraped Ads view.

If the retry still finds nothing, the line prints each card's tracking-id
prefix:

- all `uuid`-style prefixes: Flipkart served no paid slots to this session
  (personalised or logged-in profiles can see fewer ads). Nothing to fix.
- any `en_` prefix on a card reported organic: the sponsored selectors in
  `src/extractors.ts` have drifted. Run
  `npx tsx scripts/check-sponsored.ts "<term>"` to see which signal broke.
