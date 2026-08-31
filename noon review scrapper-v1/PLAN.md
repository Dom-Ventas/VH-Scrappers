# Noon Review Scraper — Implementation Plan

## Context

We have two working scrapers built on the same skeleton:

- `~/Desktop/amazonreview scrapper11` — **the reference.** Review scraper: pulls a work
  list from an API, scrapes each ASIN with a persistent Playwright/Chrome profile, POSTs
  results back.
- `~/Downloads/Archive 2/flipkart-scraper` — same skeleton, ad/listing domain, adds
  `retry.ts`, `logger.ts` and a split `extractors/` folder.

This project builds the **Noon** equivalent with an identical module layout, identical
control flow, and an identical API contract — so the three scrapers stay
interchangeable for whoever operates them.

The backend API does not exist yet, so Phase 1 ships a **local Express mock server**
that speaks the exact contract the real API will speak. Cutting over later is a
two-line `.env` change; no scraper code moves.

---

## Findings from live Noon recon

All of the below was verified against live `noon.com` PDPs, not assumed.

### 1. The identifier is the **Noon SKU** — the direct ASIN / FSN equivalent

| Platform | Identifier | Example      |
| -------- | ---------- | ------------ |
| Amazon   | ASIN       | `B0CS6MV3ZD` |
| Flipkart | FSN        | `MOBGTAGPBUZ8ZFDS` |
| **Noon** | **SKU**    | `N70140491V` |

Exposed cleanly in the PDP's JSON-LD as `Product.sku`. There are at least two shapes —
`N` + 8 digits + a trailing letter (`N70140491V`) and a longer `Z…Z` form
(`Z44E5C508ADFB5FF3C397Z`, seen on perfume listings) — so the scraper validates nothing
and passes the SKU straight into the URL.

**URL construction is trivial** — better than Amazon's. Noon resolves a PDP by SKU alone
and ignores the slug:

```
https://www.noon.com/uae-en/<SKU>/p/            ← slug-less, works (noon's own internal links use this)
https://www.noon.com/uae-en/<any-slug>/<SKU>/p/ ← wrong slug still resolves, canonical self-corrects
```

Verified: navigating a Galaxy-S24 slug with SKU `N70103349V` served the correct Clikon
washing machine and rewrote `<link rel=canonical>` to the right slug. So `buildProductUrl()`
needs nothing but the SKU — no slug lookup, no search-resolution step.

There is also a **dedicated reviews route**, the analogue of Amazon's `/product-reviews/`:

```
https://www.noon.com/uae-en/reviews/<SKU>/
```

### 2. Noon has **no A+ content** in the Amazon sense

This is the significant divergence from the Amazon scraper. Amazon's `aplus_content`
detects brand-authored rich-media modules (`#aplus_feature_div`, `.aplus-v2`,
`premium-aplus`, brand story…). **Noon has no such module.** A Noon PDP is a fixed
template for every product:

- Product Overview (plain description text)
- HIGHLIGHTS (bullet list)
- SPECIFICATIONS (key/value table)
- Image gallery
- A brand-store *link* (`/uae-en/samsung/`) — just an anchor, not embedded content

Sellers cannot inject custom rich-media blocks. Scanning a major-brand PDP (Samsung
Galaxy S25 Ultra) for every rich-content marker found only the cookie banner and that
brand-store anchor.

**Decision (confirmed with the user): the field is dropped entirely.** A richness
proxy was built first, but since Noon has no A+ equivalent the number would have
measured nothing meaningful, so `aplus_content` is not collected and not sent.

### 3. What the PDP hands us for free (JSON-LD)

`script[type="application/ld+json"]` → `@type: Product` is a far more robust source than
DOM selectors, and it survives redesigns:

| Field | JSON-LD path | Amazon equivalent |
| --- | --- | --- |
| SKU | `sku` | `asin` |
| Rating | `aggregateRating.ratingValue` | `rating` |
| Rating count | `aggregateRating.reviewCount` | `totalRatings` |
| Availability | `offers.availability` | — |
| Price / currency | `offers.price` / `offers.priceCurrency` | — |
| **Delivery days** | `offers.shippingDetails.deliveryTime.handlingTime` + `transitTime` (`minValue`/`maxValue`, `unitCode: DAY`) | `deliveryPromiseDays` |
| Sample reviews | `review[]` (5 only, unfiltered) | — |

**Delivery is numeric already.** Amazon needs `delivery.ts` — 250 lines of multilingual
date parsing — because it only publishes free text. Noon publishes
`handlingTime{0..2} + transitTime{1..2}` as structured days. We can compute
`deliveryPromiseDays` arithmetically and only fall back to text parsing ("Get it
Tomorrow") when the JSON-LD block is absent. **We can drop `delivery.ts` almost entirely.**

### 4. Reviews are lazy-loaded and the star filter is **click-driven, not URL-driven**

This is the main behavioural difference from the Amazon scraper.

- Reviews render into `#ReviewArea` only after it scrolls into view.
- Review card selector: `[class*="noonReviewItem"]` — CSS-module hashed
  (`_noonReviewItem_1oceu_29`), so **always prefix-match, never use the full class**;
  the hash changes on every Noon CSS deploy.
- Per card: author, "Verified Purchase" badge, date, variant attributes, star rating, body text.
- A rating histogram is present (5★ 84%, 4★ 9%, 3★ 3%, 2★ 1%, 1★ 3%).
- Controls are dropdowns with **no URL parameters**: `Filter By: All Stars`,
  `Sort By: Top Reviews`, plus More Filters (verified-purchase-only, with-images,
  this-product-only).

Amazon can jump straight to `?sortBy=recent&filterByStar=critical`. Noon cannot — we must
drive the UI. Strategy, in order:

1. Open `/uae-en/reviews/<SKU>/`, scroll `#ReviewArea` into view.
2. Click **Filter By → 1★**, harvest; repeat for **2★**. (Cuts 29,967 reviews to ~4%.)
3. Set **Sort By → Most Recent** to match Amazon's `sortBy=recent`.
4. Paginate by scrolling / "load more" until exhausted or `maxCriticalReviews` is hit.
5. **Fallback** if the dropdown can't be driven: harvest unfiltered and drop
   `rating > 2` client-side — which the Amazon extractor already does anyway
   (`extractors.ts`: `if (rating > 2) continue;`), so the safety net is free.

### 5. Anti-bot posture

Noon runs **Akamai Bot Manager** (sensor POSTs to an obfuscated path) and serves its data
through internal `/_vs/...` routes and opaque `/_serverFn/<hash>` React server functions.

Two consequences:

- **Do not scrape the internal APIs.** The `_serverFn` hashes rotate on every deploy.
  Render the page in a real browser and read the DOM + JSON-LD, exactly as the Amazon
  scraper does.
- Reuse `browser.ts` verbatim: `launchPersistentContext` on a real Chrome channel,
  desktop UA, `--disable-blink-features=AutomationControlled`. That posture already passes
  Noon today.

### 6. Markets

noon.com itself runs seven storefronts, but the **backend's `Marketplace` table defines
only two** — `NNAE` (Noon UAE) and `NNSA` (Noon KSA) — and the short code is the join
key, so those are the only two the scraper can ever be asked for. `marketplaces.ts`
carries exactly those keys; adding speculative ones would only hide a future mismatch.

Noon selects delivery area by **city**, not postcode — so `MarketplaceConfig` carries
`city`, not Amazon's `zipcode`.

---

## Target structure

Mirrors `amazonreview scrapper11/src` one-for-one. Same filenames, same responsibilities.

```
noon review scrapper-v1/
├── .env                        # gitignored
├── .env.example
├── package.json
├── tsconfig.json
├── PLAN.md
├── mock-server/
│   ├── server.ts               # Express stand-in for the real API
│   ├── queries.json            # seed work list (edit to change test set)
│   └── received/               # POSTed results land here as JSON
└── src/
    ├── index.ts                # orchestrator — profile loop → query loop → scrape → POST
    ├── config.ts               # env + defaults + profileDir resolution
    ├── browser.ts              # persistent Chrome context      (copy from Amazon, unchanged)
    ├── marketplaces.ts         # NNAE / NNSA
    ├── types.ts                # Query, Review, ProductReviewResult, ScrapedResult, UserSettings
    ├── util.ts                 # sleep, parseIntSafe, parseFloatSafe, normalizeText  (copy, unchanged)
    ├── retry.ts                # from flipkart-scraper — wrap each scrape
    ├── logger.ts               # from flipkart-scraper — daily rotating file log
    ├── userSettings.ts         # load/save user-settings.json   (copy, unchanged)
    ├── firstRun.ts             # email + profileIds form, then Noon login
    ├── scraper.ts              # scrapeSku() — PDP → reviews page → paginate
    ├── extractors.ts           # JSON-LD first, DOM fallback
    └── api/
        ├── queries.ts          # GET  work list                 (copy, unchanged)
        └── results.ts          # POST result                    (copy, unchanged)
```

### Reused as-is (no rewrite)

| File | Source | Change |
| --- | --- | --- |
| `browser.ts` | Amazon | none |
| `util.ts` | Amazon | none |
| `userSettings.ts` | Amazon | none |
| `api/queries.ts` | Amazon | field rename `asin` → `sku` |
| `api/results.ts` | Amazon | none |
| `retry.ts` | Flipkart | none |
| `logger.ts` | Flipkart | none |

### Rewritten for Noon

`config.ts`, `marketplaces.ts`, `types.ts`, `scraper.ts`, `extractors.ts`, `firstRun.ts`,
`index.ts`.

### Dropped

`delivery.ts` — superseded by structured JSON-LD delivery times (finding 3). A ~15-line
text fallback for "Get it Tomorrow" / "Get it by <date>" moves into `extractors.ts`.

---

## Key files in detail

### `types.ts`

Same shapes as Amazon, `asin` → `sku`:

```ts
export interface Query {
  productId: number;
  sku: string;         // was: asin
  shortCode: string;
}

export interface Review {
  rating: number;
  title?: string;
  text?: string;
  author?: string;
  date?: string;
  verifiedPurchase?: boolean;   // Noon exposes this per card
}

export interface ProductReviewResult {
  sku: string;
  title: string;
  brand?: string;
  rating: number;
  totalRatings: number;
  criticalReviews?: Review[];
  deliveryPromiseDays?: number | null;
  deliveryText?: string;
}

export interface ScrapedResult {
  emailId: string;
  profileId: string;
  productId: number;
  sku: string;
  shortCode: string;
  rating: number;
  ratingCount: number;
  criticalReviews: Record<string, any>;
  delivery_promise_days?: number | null;
  deliveryPromiseDays?: number | null;
}
```

snake_case and camelCase duplicates are kept for delivery because the Amazon backend
accepts both — preserving that keeps one backend handler able to serve all three scrapers.

### `marketplaces.ts`

```ts
export interface MarketplaceConfig {
  url: string;      // host + locale path
  city: string;     // Noon picks delivery area by city, not postcode
  currency: string;
  country: string;
}

NNAE → www.noon.com/uae-en    Dubai    AED  United Arab Emirates
NNSA → www.noon.com/saudi-en  Riyadh   SAR  Saudi Arabia
```

`resolveMarketplace(shortCode)` throws on unknown codes — same as both existing scrapers.

### `extractors.ts`

Layered, JSON-LD first:

```ts
readProductJsonLd(page)         // parse script[type="application/ld+json"] → @type Product
extractProductDetails(page,sku) // JSON-LD → DOM fallback for title/rating/count/brand
extractDeliveryPromise(page)    // handlingTime.max + transitTime.max → days
                                //   fallback: parse "Get it Tomorrow" / "Get it by <date>"
extractReviewsOnPage(page)      // [class*="noonReviewItem"] → Review[], drops rating > 2
```

Every DOM selector goes in a `SELECTORS` map of **prefix-matched** arrays, mirroring
Amazon's `SELECTORS` + `firstText()` cascade:

```ts
reviewCards:  ['[class*="noonReviewItem"]'],
reviewBody:   ['[class*="reviewDesc"]', '[class*="reviewDescription"]'],
reviewTitle:  ['[class*="reviewTitle"]'],
reviewArea:   ['#ReviewArea'],
```

Never full hashed class names — see finding 4.

### `scraper.ts` — `scrapeSku(page, marketplace, sku)`

1. `goto` `https://<url>/<sku>/p/`, `waitUntil: domcontentloaded`.
2. Dismiss the cookie banner (ACCEPT ALL / SAVE PREFERENCES) — appears on first run per profile.
3. Guard: if JSON-LD is missing *and* no product title → `throw new Error("Invalid SKU")`,
   matching Amazon's invalid-ASIN guard.
4. `extractProductDetails` → title, brand, rating, ratingCount.
5. `extractDeliveryPromise` **before** any scrolling.
6. `goto` `https://<url>/reviews/<sku>/`.
8. Scroll `#ReviewArea` into view; wait for `[class*="noonReviewItem"]`.
9. Apply Filter By → 1★, then 2★; Sort By → Most Recent. Fall back to client-side
   `rating > 2` filtering if the dropdowns don't respond.
10. Loop: harvest → scroll/load-more → stop at end, `maxCriticalReviews`, or `maxReviewPages`.
11. Return `ProductReviewResult`.

Wrapped in `retry(fn, 3, 3000)` from `retry.ts`.

### `index.ts`

Identical control flow to Amazon's `index.ts` — no structural change:

```
load settings → (firstRun if none) → open persistent context
  for each profileId:
    fetchQueries(profileId)
    apply SCRAPE_SHORT_CODES filter
    for each query:
      scrapeSku()  →  postScrapedResult()
      sleep(SCRAPE_DELAY_MS)   // skipped on the very last item
```

Same `[BOOT]` / `[PROFILE]` / `[SCRAPE]` / `[OK]` / `[FAIL]` / `[WAIT]` / `[DONE]` log
prefixes, so operators read all three scrapers the same way.

---

## Mock server

`mock-server/server.ts` — Express (already a dependency in both reference projects).
Its only job is to be **contract-identical** to the future real API.

```
GET  /backend/api/v1/scrapper/review-queries?profile_id=<id>
     Authorization: Bearer <API_TOKEN>
     → 200 { items: [ { productId, sku, shortCode }, ... ] }

POST /backend/api/v1/scrapper/reviews
     Authorization: Bearer <API_TOKEN>
     body: ScrapedResult
     → 200 { ok: true }
     side effect: writes mock-server/received/<sku>-<timestamp>.json
```

Behaviour:

- Work list read from `mock-server/queries.json` (hot-reloaded per request, so you can
  edit the test set without restarting).
- Filters `items` by `profile_id`, matching the real endpoint's semantics.
- Validates the bearer token, returns 401 on mismatch — so auth bugs surface now, not at cutover.
- Logs every POST body to stdout for eyeballing.
- Port from `MOCK_PORT`, default `4000`.

`queries.json` seed uses real SKUs verified during recon:

```json
[
  { "profileId": "demo", "productId": 1, "sku": "N70140491V", "shortCode": "NNAE" },
  { "profileId": "demo", "productId": 2, "sku": "N70103349V", "shortCode": "NNAE" }
]
```

**Cutover to the real API is exactly two lines of `.env`** — nothing in `src/` changes:

```
QUERIES_API_URL=http://localhost:4000/backend/api/v1/scrapper/review-queries
RESULTS_API_URL=http://localhost:4000/backend/api/v1/scrapper/reviews
```

### `.env.example`

```
API_TOKEN=
QUERIES_API_URL=http://localhost:4000/backend/api/v1/scrapper/review-queries
RESULTS_API_URL=http://localhost:4000/backend/api/v1/scrapper/reviews
SCRAPER_PROFILE_DIR=
SCRAPE_DELAY_MS=30000
DEFAULT_NOON_LOCALE=www.noon.com/uae-en
SCRAPE_SHORT_CODES=
BROWSER_VISIBLE=
MOCK_PORT=4000
```

### `package.json` scripts

```
"mock":  "tsx mock-server/server.ts"
"dev":   "tsx src/index.ts"
"build": "tsc"
```

Uses `tsx` (Flipkart's choice) over `ts-node` — faster and already proven in the sibling project.

---

## Build order

1. Scaffold `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`.
2. Copy the unchanged modules (`browser.ts`, `util.ts`, `userSettings.ts`, `api/*`, `retry.ts`, `logger.ts`).
3. `types.ts`, `config.ts`, `marketplaces.ts`.
4. Mock server + `queries.json` — stand it up and curl it before any scraping code runs.
5. **Selector-discovery pass**: drive one live PDP and one live reviews page with a
   throwaway script, confirm every selector and the filter-dropdown interaction, and pin
   the results into `SELECTORS`. This is the step most likely to need iteration — Noon's
   hashed CSS modules mean selectors must be checked against the live site, not guessed.
6. `extractors.ts`, then `scraper.ts`.
7. `firstRun.ts` + `index.ts`.
8. End-to-end run against the mock.

---

## Verification

- `npm run mock`, then confirm the contract by hand:
  ```bash
  curl -H "Authorization: Bearer $API_TOKEN" "http://localhost:4000/backend/api/v1/scrapper/review-queries?profile_id=demo"
  ```
- `BROWSER_VISIBLE=1 npm run dev` — watch the first run: settings form → Noon login →
  PDP → reviews page → star filter applied.
- Confirm `mock-server/received/` fills with one JSON per SKU, each carrying non-zero
  `rating` / `ratingCount`, a `criticalReviews.reviews` array where **every** entry is
  `rating <= 2`, and a non-null `deliveryPromiseDays` for an in-stock SKU.
- Cross-check one result by hand against the live PDP (rating, review count, delivery).
- Negative cases: a bad SKU must `[FAIL]` and continue to the next query, not crash the
  run; an out-of-stock SKU must yield `deliveryPromiseDays: null` (0 stays reserved for
  same-day, as in the Amazon scraper).
- Re-run to confirm the persistent profile skips first-run and stays logged in.

---

## Open questions

1. **Markets to ship.** All seven storefronts, or UAE-only first? Arabic locales
   (`uae-ar`) as separate short codes?
3. **Review volume cap.** Amazon uses `maxCriticalReviews: 1000`. Noon SKUs can carry
   30k+ reviews, and pagination is scroll-driven — a 1000-review cap could mean a lot of
   scrolling per SKU. Suggest starting at 200 and raising once throughput is measured.
4. **Extra fields.** Price, currency, availability, and seller are all cheap to grab from
   the JSON-LD we already parse. Include them, or hold strict schema parity with Amazon?
