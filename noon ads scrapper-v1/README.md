# noon ads scraper (`noon-search-term-scrapper.exe`)

Scrapes noon **search-result pages** for search terms supplied by the VentaWiz
backend (`GET /v1/scrapper/search-term-queries`), reporting the sponsored and
organic products found on page one (`POST /v1/scrapper/search-term-results`).

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

First run opens a setup page for your email + VentaWiz **store IDs** (positive
integers), then the noon storefront for a one-time sign-in. When the agent
launches the scraper it passes `SCRAPE_STORE_IDS`, and no setup form is shown.

Each run fetches the whole queue for those stores once (paged, up to 50 store
ids per request), scrapes every term, and posts one result per term:
`{ store_id, search_term, products: [{ position, mp_product_id, is_sponsored,
price, rating, review_count, delivery_days, title }] }` — up to 5 sponsored + 5
organic, missing values `null`. An empty `products` is still posted. A 409
("already scraped today") counts as success.

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
| `VH_API_ROOT` | `http://localhost:8000` (`src/embedded.ts`) | VentaWiz server root |
| `QUERIES_API_URL` | `${VH_API_ROOT}/v1/scrapper/search-term-queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `${VH_API_ROOT}/v1/scrapper/search-term-results` | Where to post results |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated store ids; set by the agent |
| `SCRAPE_MARKETPLACE` | `noon` | Sent as `marketplace=` on the queue request |
| `VW_AUTH_URL` | `http://localhost:8100` (real host baked in at build time) | VentaWiz auth service root; token exchange is `POST /v1/token` |
| `VW_CLIENT_ID` | *(set by the agent)* | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | *(set by the agent)* | VentaWiz service account secret, `vws_…` — never commit it |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\NoonSearchTermScrapper\chrome-profile` | Chrome profile holding the login |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `NNAE` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_NOON_DOMAIN` | `www.noon.com` | Host used for the first-run login |
| `DEFAULT_NOON_LOCALE` | `uae-en` | Storefront opened on first run |

These defaults come from `src/embedded.ts` (hosts only — no secret is baked
in). The agent overrides the URLs, auth URL and service account when it
launches this scraper — environment always beats baked-in.

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
