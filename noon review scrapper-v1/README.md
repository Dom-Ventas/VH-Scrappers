# Noon Review Scraper

Scrapes Noon product ratings and critical reviews, mirroring the structure and
control flow of the Amazon and Flipkart scrapers so all three are operated the
same way.

Pulls a work list from the VentaWiz backend (`GET /v1/scrapper/review-queries`),
scrapes each SKU with a persistent Chrome profile, and POSTs one result per
queue item to `POST /v1/scrapper/reviews`.

## Quick start

```bash
npm install
```

Run the scraper:

```bash
npm run dev
```

First launch opens a settings form (email + VentaWiz **store IDs**, positive
integers), then Noon so you can log in if you want to. Both are saved into the
Chrome profile folder and reused, so later runs are unattended. When the agent
launches the scraper it passes `SCRAPE_STORE_IDS` and no form is shown. An old
`user-settings.json` holding only VentaHub `profileIds` counts as no settings.

## How it maps to the other scrapers

| | Amazon | Flipkart | **Noon** |
| --- | --- | --- | --- |
| Identifier | ASIN | FSN | **SKU** (`N70140491V`, `Z44E5C…Z`) |
| Product URL | `/dp/<ASIN>` | slug + FSN | `/<locale>/<SKU>/p/` |
| Reviews URL | `/product-reviews/<ASIN>/` | — | `/<locale>/reviews/<SKU>/` |
| Critical filter | `?filterByStar=critical` in URL | — | Sort By → Lowest Rating (click) |

Noon resolves a PDP from the SKU alone and rewrites the canonical URL itself, so
no slug lookup is needed. SKUs come in at least two shapes — `N` + digits + a
letter (`N70140491V`) and a longer `Z…Z` form (`Z44E5C508ADFB5FF3C397Z`) — so
nothing validates the format; the SKU is passed through as given.

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

Copy `.env.example` to `.env`. The values that matter day to day:

| Variable | Meaning |
| --- | --- |
| `VH_API_ROOT` | VentaWiz server root; default in `src/embedded.ts` |
| `QUERIES_API_URL` / `RESULTS_API_URL` | Full overrides of `${VH_API_ROOT}/v1/scrapper/review-queries` and `…/reviews` (set by the agent) |
| `SCRAPE_STORE_IDS` | Comma-separated store ids; set by the agent, else `user-settings.json` |
| `SCRAPE_MARKETPLACE` | Sent as `marketplace=` on the queue request (default `noon`) |
| `VW_AUTH_URL` | VentaWiz auth service root; default in `src/embedded.ts` (`http://localhost:8100`) |
| `VW_CLIENT_ID` / `VW_CLIENT_SECRET` | VentaWiz service account (`svc_…` / `vws_…`); set by the agent — see *Service account* |
| `SCRAPER_PROFILE_DIR` | Chrome profile + `user-settings.json` live here |
| `SCRAPE_DELAY_MS` | Pause between SKUs (default 30s) |
| `MAX_CRITICAL_REVIEWS` | Cap per SKU (default 200) |
| `SCRAPE_SHORT_CODES` | Optional local allow-list on `short_code`, e.g. `NNAE,NNSA`. Empty = everything |
| `BROWSER_VISIBLE` | `1` to watch the run; otherwise the window is parked off-screen |

### Markets

Two, and the keys must match the backend's `Marketplace.short_code` exactly:

| Short code | Store | Locale path | Currency |
| --- | --- | --- | --- |
| `NNAE` | Noon UAE | `www.noon.com/uae-en` | AED |
| `NNSA` | Noon KSA | `www.noon.com/saudi-en` | SAR |

Noon's other storefronts (Egypt, Kuwait, Bahrain, Oman, Qatar) are deliberately
**not** in `src/marketplaces.ts` — no marketplace row exists for them, so no
query can ever carry their code. Add an entry here at the same time one is
added to the `Marketplace` table. An unrecognised code fails that SKU (naming
the codes it does know) and the run continues.

### Requires a real display

**The browser always runs headed.** Noon's Akamai protection blocks headless
Chrome outright — its built-in user agent contains `HeadlessChrome` — so
`browser.ts` launches headed regardless and parks the window off-screen at
`-32000,-32000` when `BROWSER_VISIBLE` is not set. Unattended runs therefore
still need a display session; on a headless Linux box, run it under `xvfb-run`.

## Queue and results

```
GET /v1/scrapper/review-queries?store_id=13&store_id=16&marketplace=noon&page=1&limit=100
 -> { items: [ { product_ids: [101, 102], mp_product_id: "N70140491V", short_code: "NNAE", store_id: 13 } ],
      pagination: { page, limit, total, pages } }
```

The whole queue is fetched once per run (pages followed to the end, store ids
sent 50 per request). `mp_product_id` is the noon zsku / SKU; `short_code` picks
the storefront.

> The old `mock-server/` (VentaHub contract) is not in the repo, so `npm run
> mock` does not work.

### Auth

Every scrapper endpoint takes a bearer token from the laptop's VentaWiz
service account — see *Service account* above. The backend takes the tenant
from the token and requires `scrapper:run`; a store outside the account's
grant answers 404, like a missing one. `.env` is gitignored and `.env.example`
leaves the credentials blank.

## What gets collected

```jsonc
{
  "store_id": 13, "product_ids": [101, 102],   // copied from the queue item
  "rating": 4.7,                 // 0-5, 2 decimals; null when there are no ratings
  "rating_count": 48382,
  "critical_reviews": { "reviews": [ /* every review rated 1 or 2 */ ] },
  "aplus_content": null,         // noon has no A+ module
  "delivery_promise_days": 1,    // promised date - today; null when none shown
  "price": 2699, "currency": "AED", "availability": "InStock"  // noon extras, ignored by the backend
}
```

A 404 means a product id is not a focused listing of that store; the item is
logged `[FAIL]` with the backend's message.

Each review carries `rating`, `title`, `text`, `author`, `date` and
`verifiedPurchase`.

> **No A+ content.** Noon has no Amazon-style A+ module — every PDP uses
> the same fixed template and sellers cannot inject rich-media blocks — so
> `aplus_content` is always sent as `null`.

## Notes for whoever maintains this

- **Selectors must stay prefix-matched.** Noon ships hashed CSS-module classes
  (`_noonReviewItem_1oceu_29`); the hash changes on every CSS deploy. All
  selectors live in `SELECTORS` in `src/extractors.ts` and match on the stable
  prefix only.
- **Review ratings are read from the star `color` attribute**, not the star
  count. Noon draws all five stars with the same filled SVG and greys out the
  unlit ones (`color="grey3"`), so the rating is the count of non-grey icons.
- **Pagination is click-only.** The page links carry no `href` and `?page=N` is
  ignored, so pages are advanced by clicking the numbered link.
- **The Lowest Rating sort is what keeps this cheap.** With it applied, the run
  stops at the first page holding no 1–2 star review — a SKU with 48k ratings
  yields its ~380 critical reviews in ~27 pages instead of 1,999.
- **Never set a `userAgent` override.** The Amazon scraper pins a Windows
  Chrome 124 string because it ships as a Windows `.exe`. Carrying that over
  here made noon's *Saudi* storefront return "Access Denied" on every request
  while the UAE one still worked — the claimed platform contradicted the real
  TLS fingerprint. Chrome's own user agent always matches the host.
- **A missing Product JSON-LD block is never treated as an empty product.**
  Akamai's block page would otherwise scrape cleanly as `rating=0,
  ratingCount=0` and post that as real data. `scraper.ts` separates a block
  (retryable) from a genuine unknown SKU (`PermanentError`, no retries).
- **Do not scrape Noon's internal APIs.** Noon runs Akamai Bot Manager and
  serves data through `/_serverFn/<hash>` endpoints whose hashes rotate on every
  deploy. Rendering the page in a real Chrome profile is what works.
- **`page.evaluate` needs the `__name` shim.** tsx/esbuild compiles with
  `keepNames`, which rewrites evaluated functions to call a helper that does not
  exist in the browser. `browser.ts` installs a no-op shim via `addInitScript`;
  removing it breaks every `evaluate` with an inner named function.
- Logs mirror to `logs/<date>.log`, kept 7 days.

## Layout

```
src/
  index.ts          orchestrator: store ids -> queue (all pages) -> scrape -> POST
  config.ts         env + defaults
  browser.ts        persistent Chrome context (+ the evaluate shim)
  marketplaces.ts   short code -> locale/city/currency
  scraper.ts        scrapeSku(): PDP -> reviews -> sort -> paginate
  extractors.ts     JSON-LD first, DOM fallback; all selectors live here
  types.ts          Query, Review, ProductReviewResult, ScrapedResult
  util.ts           text helpers + PermanentError
  retry.ts          3 attempts, skipped for PermanentError
  logger.ts         daily rotating file log
  userSettings.ts   load/save user-settings.json
  firstRun.ts       first-launch settings form + Noon login
  api/              fetchQueries / postScrapedResult
```

`PLAN.md` records the design and the live recon it was based on.
