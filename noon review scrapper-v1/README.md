# Noon Review Scraper

Scrapes Noon product ratings and critical reviews, mirroring the structure and
control flow of the Amazon and Flipkart scrapers so all three are operated the
same way.

Pulls a work list from an API, scrapes each SKU with a persistent Chrome
profile, POSTs results back. The real backend does not exist yet, so a local
**mock server** speaks the exact contract it will speak — cutting over is two
lines of `.env`.

## Quick start

```bash
npm install
```

Start the mock API (leave it running in its own terminal):

```bash
npm run mock
```

Then run the scraper:

```bash
npm run dev
```

First launch opens a settings form (email + profile IDs), then Noon so you can
log in if you want to. Both are saved into the Chrome profile folder and reused,
so later runs are unattended.

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

## Configuration

Copy `.env.example` to `.env`. The values that matter day to day:

| Variable | Meaning |
| --- | --- |
| `QUERIES_API_URL` / `RESULTS_API_URL` | Production by default; point at the mock to develop offline |
| `API_TOKEN` | Bearer sent on both calls — the one shared scrapper token (see below) |
| `SCRAPER_PROFILE_DIR` | Chrome profile + `user-settings.json` live here |
| `SCRAPE_DELAY_MS` | Pause between SKUs (default 30s) |
| `MAX_CRITICAL_REVIEWS` | Cap per SKU (default 200) |
| `SCRAPE_SHORT_CODES` | Allow-list, e.g. `NNAE,NNSA`. Empty = everything |
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

## Mock server

`mock-server/server.ts` is contract-identical to the future API — same paths,
same bearer check, same response shapes.

```
GET  /api/v1/scrapper/noon/review-queries?profile_id=<id>   -> { items: [...] }
POST /api/v1/scrapper/noon/reviews                          -> { ok: true }
```

- Work list: `mock-server/queries.json`, re-read on every request so you can
  edit the test set without restarting. Rows carry a `note` field describing
  what each SKU is there to exercise; the server ignores it.
- Two seeded profiles: **`demo`** — 10 real SKUs across 7 categories and both
  `NNAE` and `NNSA`, review counts from 9 to 48,000 — and **`edge`**, holding the
  awkward cases (zero-rating product, unavailable product, non-existent SKU,
  unknown short code). Point `profileIds` in `user-settings.json` at whichever
  you want to run.
- Results: written to `mock-server/received/` as one JSON per SKU.
- Rejects a wrong bearer token with 401, and a missing `profile_id` with 400, so
  auth and parameter bugs surface now rather than at cutover.

### Switching between production and the mock

`.env` ships pointed at production. To develop offline, swap the two URLs to the
mock — nothing in `src/` moves either way:

```
QUERIES_API_URL=http://localhost:4000/api/v1/scrapper/noon/review-queries
RESULTS_API_URL=http://localhost:4000/api/v1/scrapper/noon/reviews
```

The mock serves both the bare `/api/v1/...` paths and the `/backend`-prefixed
ones, matching the backend's `api_v1_prefix` and its production proxy mount.

### Auth

The backend authenticates **every** scrapper endpoint — Amazon, Flipkart and
Noon alike — against a single shared static bearer, `settings.scrapper_api_token`
(`src/modules/scrapper/dependencies.py`). There is no per-scraper token: the
value in `API_TOKEN` is the same one the other scrapers use. `.env` is
gitignored and `.env.example` deliberately leaves it blank.

## What gets collected

```jsonc
{
  "emailId": "...", "profileId": "demo", "productId": 1,
  "sku": "N70140491V", "shortCode": "NNAE",
  "rating": 4.7,                 // aggregate rating
  "ratingCount": 48382,
  "criticalReviews": { "reviews": [ /* every review rated 1 or 2 */ ] },
  "delivery_promise_days": 1,    // promised date - today; null when none shown
  "price": 2699, "currency": "AED", "availability": "InStock"
}
```

`delivery_promise_days` is sent in both snake_case and camelCase, matching what
the Amazon scraper already posts, so one backend handler can serve all three.

Each review carries `rating`, `title`, `text`, `author`, `date` and
`verifiedPurchase`.

> **No A+ content field.** Noon has no Amazon-style A+ module — every PDP uses
> the same fixed template and sellers cannot inject rich-media blocks — so
> nothing equivalent is collected or sent.

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
  index.ts          orchestrator: profile loop -> query loop -> scrape -> POST
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
mock-server/
  server.ts         stand-in API
  queries.json      seed work list
  received/         POSTed results land here
```

`PLAN.md` records the design and the live recon it was based on.
