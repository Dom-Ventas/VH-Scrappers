# Flipkart Review Scraper — Implementation Plan

Mirror of `amazonreview scrapper11`: same module layout, same config/settings/API
flow, same output fields. Only the extraction layer is Flipkart-specific.

All Flipkart behaviour below was verified live against flipkart.com on 2026-08-18
(iPhone 15 `MOBGTAGPTB3VS24W`, boAt Rockerz 255 `ACCGJP5QSJFP7HAP`).

---

## 1. Identifier: PID replaces ASIN

Flipkart's stable product key is the **PID** (`MOBGTAGPTB3VS24W`,
`ACCGJP5QSJFP7HAP`) — 16 chars, uppercase alphanumeric. The `itm…` slug in the
pretty URL is *not* stable and not needed.

**Verified:** `https://www.flipkart.com/product/p/itme?pid=<PID>` resolves to the
full product page with intact JSON-LD. This is the exact analogue of Amazon's
`/dp/<ASIN>` and is what `buildProductUrl()` will emit.

**Verified:** an unknown PID redirects to the Flipkart homepage with the title
`Buy Products Online at Best Price in India - All Categories`. That is the
invalid-PID guard, replacing Amazon's `Looking for something` / `Page Not Found`
check.

---

## 2. The critical structural difference — read this first

Amazon's DOM is selector-friendly (`[data-hook="review"]`, `#productTitle`).
**Flipkart's is not.** The current review page is React-Native-Web rendered:
every element carries the same emotion-generated class (`css-g5y9jx`,
`css-146c3p1`) with all styling inline. There are no semantic classes, no
`data-*` hooks, no stable ids.

Porting Amazon's `SELECTORS` map 1:1 would produce a scraper that breaks on the
first deploy. Extraction is therefore layered, most-stable-first:

| Layer | Source | Used for |
|---|---|---|
| 1 | `<script type="application/ld+json">` | title, rating, ratingCount, availability, brand, category |
| 2 | Product-page section headings (text anchors) | Showcase / A+, delivery block |
| 3 | `innerText` block parsing against the repeating review pattern | review cards |
| 4 | CSS/inline-style heuristics | last-resort fallback only |

**Verified JSON-LD payload** (identical shape on both test products):

```json
{ "name": "...", "sku": "MOBGTAGPTB3VS24W", "brand": {"name": "APPLE"},
  "category": "mobile",
  "aggregateRating": { "ratingValue": 4.6, "ratingCount": 247238, "reviewCount": 9634 },
  "offers": { "price": 57900, "availability": "https://schema.org/InStock" } }
```

`ratingValue` → `rating`, `ratingCount` → `totalRatings`. No parsing of
`"4.6 | 2,47,238"` display text needed, and Indian digit grouping
(`2,47,238`) — which would break Amazon's `parseIntSafe` assumptions — never
enters the picture.

---

## 3. Field-by-field mapping

| Amazon field | Flipkart source | Confidence |
|---|---|---|
| `asin` | PID | verified |
| `title` | JSON-LD `name` | verified |
| `rating` | JSON-LD `aggregateRating.ratingValue` | verified |
| `totalRatings` | JSON-LD `aggregateRating.ratingCount` | verified |
| `criticalReviews` | review page, client-side filtered (§4) | verified |
| `aplus_content` | `RPD` widget w/ non-empty `featureSetList` (§5) | verified, 24 products / 9 categories |
| `deliveryPromiseDays` | delivery block (§6) | verified |
| `bestSellersRank` | **no equivalent exists** (§7) | — |

Everything else — `emailId`, `profileId`, `productId`, `shortCode`, the
`criticalReviews: { reviews: [...] }` envelope, the dual snake_case/camelCase
keys — is copied unchanged so the backend payload stays byte-compatible.

---

## 4. Critical reviews — the main engineering problem

**Review URL:** `https://www.flipkart.com/product/product-reviews/itme?pid=<PID>&sortOrder=MOST_RECENT&page=<N>`
(the generic `itme` slug works here too — verified).

Three findings that shape the design:

1. **No star filter.** `&rating=1` is accepted but silently ignored — page 1 with
   `rating=1` returned ratings `5,5,4,5,1,5,5,1,3,5`. The star histogram in the
   left rail is display-only (`cursor: auto`, click changes nothing). Amazon's
   `filterByStar=critical` has **no Flipkart equivalent.** All filtering is
   client-side, same `rating <= 2` predicate as `extractCriticalReviews`.
2. **`page=N` works server-side.** Verified: `page=3` returns a distinct, older
   set. 10 reviews per page. This drives the pagination loop — no "Next" button
   to click, no anchor hrefs (there are none), just increment the URL.
3. **Infinite scroll is a trap.** Scrolling the review page programmatically
   stalls at "Hang on, loading content" and never appends past the initial 10.
   Do not try to scroll-load; page through URLs.

**Cost consequence, and the one number you need to decide.** With no server-side
filter, reaching N critical reviews means paging through roughly `N / (critical
share × 10)` pages. On the iPhone 15, 1★+2★ is ~6% of ratings — so ~1000 pages
to collect 600 critical reviews. Amazon's current `maxCriticalReviews: 1000` is
unreachable on Flipkart at any sane runtime.

Proposed defaults, both env-overridable: `maxReviewPages: 30` (300 reviews
scanned, ~2–4 min/product) and `maxCriticalReviews: 200`, with the loop also
stopping early on an empty page. **Confirm these numbers** — they trade
completeness against per-product runtime, and it's your call, not mine.

**Review extraction — superseded, see below.** The original design parsed review
cards out of the page's innerText. That still exists as a fallback, but the
primary path is now the page-data API (`§4a`), which returns one typed
`REVIEWS` widget per review. That restores the Amazon architecture — a list of
review units with named fields — and returns bodies in full.

---

## 4a. Reviews via the page-data API (primary)

`POST /api/4/page/fetch` with the review-page URI returns 22 widgets:

```
PRODUCT_MIN, REVIEW_IMAGES, PAGE_TITLE, REVIEW_FILTERS, ASPECT_CARDS,
RATING, REVIEWS ×10, PAGINATION_BAR
```

Each `REVIEWS` widget holds one `ProductReviewValue`:

```jsonc
{ "type": "ProductReviewValue",
  "rating": 1, "title": "Horrible", "text": "<full body, never clipped>",
  "author": "Roshan Joseph", "created": "5 days ago",
  "location": { "city": "Mumbai", "state": "Maharashtra" },
  "certifiedBuyer": true, "helpfulCount": 0, "id": "<stable review id>" }
```

Three things this buys over text parsing:

1. **Full message bodies.** The rendered page clips long reviews with "...more",
   and that control ignores synthetic clicks (same React-Native-Web problem as
   the pincode modal). The DOM path *cannot* capture a long review completely —
   a 184-character review measured in testing would have been cut.
2. **Named fields instead of positional guessing.** This is structurally what
   `extractCriticalReviews` does on Amazon: get review units, read each field by
   name. Only the accessor differs — JSON keys instead of DOM selectors.
3. **`PAGINATION_BAR.totalPages`** gives the real page count (241 for the boAt,
   468 for the Sony), so the crawl stops at the true end of the list rather than
   inferring it from an empty page.

Bodies come back HTML-escaped (`call &amp; battery`, `It&rsquo;s`), so they are
entity-decoded before storage — otherwise every downstream reader has to.

**No server-side star filter — now confirmed twice.** Beyond the ignored
`rating=` URL param, `REVIEW_FILTERS` exposes only `certifiedBuyerFilter`
(`paramName: reviewerType`) and `sortOptions`. There is no rating facet, so the
client-side filtering and the page-budget limits in §4 stand unchanged.

**Fallback.** If the API response is unusable the DOM text parser runs, and
anything it returns is flagged `truncated` where clipped. An *empty* review page
is not treated as a failure — that is a legitimate end-of-list, and falling back
on it would make every last page pay for a DOM scrape.

---

**DOM fallback parsing.** Cards are text blocks in a strict repeating shape:

```
5.0 • Great product
Review for: Color Blue • Storage 128 GB     ← optional variant line
Very good mobile 🥰😍                        ← body
Arka Sarkar
, Kalyani                                    ← author, location
Helpful
Verified Purchase · Today                    ← relative date
```

Parser: split `innerText` on the `^\d\.0$` rating boundary, then read
title / body / author / location / date positionally, tolerating the optional
`Review for:` line. Emitted `Review` gains two Flipkart-only optional fields —
`location` and `verifiedPurchase` — which the backend can ignore.

Two gotchas to handle:
- **Truncated bodies.** Long reviews end in `… more` and need the "more" control
  clicked (or the full text pulled from the card's DOM node) before capture.
- **Relative dates.** Flipkart gives `Today`, `1 day ago`, `3 months ago` — never
  an absolute date. Store the raw string in `date` (matching Amazon, which also
  stores raw text) and add `dateDays` (a resolved day-offset) if the backend
  wants sortable values.

---

## 5. A+ content equivalent — **RPD** (resolved)

Flipkart's analogue of Amazon A+ is the **`RPD` widget — Rich Product
Description**. This section replaces an earlier draft that proposed the
"Showcase" section; that proposal was **wrong** and is documented below so the
mistake isn't repeated.

### The rule

```
aplus_content = "yes"  ⟺  the product page returns an RPD widget
                          whose data.featureSetList contains ≥ 1 feature
```

### Why "Showcase" was wrong

"Showcase" is a **tab label in the section nav bar**
(`All details | Showcase | Specifications | Warranty | Manufacturer info`), not a
content section. Its container holds 0 images and an `innerText` of length 8 —
literally just the word. Decisive test: the boAt product **has** a Showcase tab
and **no** rich content; the Sony Bravia has a Showcase tab **and** rich content.
The signal doesn't discriminate. `BRAND_DATA` was the second candidate and is
also wrong — it holds warranty text and manufacturer phone numbers.

### What RPD actually contains

```jsonc
"widget": { "type": "RPD", "data": {
  "featureSetList": [{
    "templateType": "right",                       // module layout template
    "features": [{
      "title": "No.1 in India officially!",
      "description": { "text": "No.1 Selling Android Smartphone in India." },
      "media": [{ "type": "photo",
                  "url": ".../cms-rpd-img/1d5d964e...jpg?q={@quality}" }]
    }]
  }],
  "overview": { ... }
}}
```

Brand-authored copy + imagery in templated modules, served from a dedicated
`cms-rpd-img` CMS bucket. That is structurally what Amazon A+ is.

### Evidence

24 products sampled across 9 categories. RPD present on **6 (~25%)**:

| Product | RPD | featureSets |
|---|---|---|
| Sony Bravia 43" | yes | 18 |
| Asus Vivobook 15 | yes | 7 |
| Himalaya face wash | yes | 6 |
| Godrej almirah | yes | 6 |
| Philips air fryer | yes | 4 |
| Samsung Galaxy S24 | yes | 1 |
| iPhone 15, boAt ×2, OnePlus, Realme, Samsung M35, Puma, Maggi, Tata Salt, Amul, Nivea, Usha, Milton, LG fridge, Dell, Nike, Lakme, Prestige, Atomic Habits | no | 0 |

The ~25% base rate and the fact that it varies *within* categories (Sony TV yes /
LG fridge no; Samsung S24 yes / M35 no; Asus yes / Dell no) confirms it tracks
per-listing brand investment rather than category — the same distribution Amazon
A+ has. A signal that fired on everything or nothing would be the warning sign.

**Rendering confirmed:** on the Sony page, `cms-rpd-img` appears 7× in the HTML
with a 1620×910 brand key-visual rendered on screen. The API data corresponds to
real on-page content, not a dormant field.

### Implementation

Primary check is the page-data API rather than the DOM, because Flipkart
lazy-renders these sections unreliably — on the Sony page only 1 of 18 RPD images
ever rendered, and on the boAt page the description area never rendered at all.
DOM-based detection would produce false negatives.

```ts
// on the product page, so cookies + origin are correct
const data = await page.evaluate(async (pid) => {
  const r = await fetch('https://www.flipkart.com/api/4/page/fetch', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json',
               'X-User-Agent': navigator.userAgent + ' FKUA/website/42/website/Desktop' },
    body: JSON.stringify({ pageUri: `/product/p/itme?pid=${pid}` })
  });
  return r.json();
}, pid);

const rpd = data.RESPONSE.slots.find(s => s.widget?.type === 'RPD');
const featureCount = (rpd?.widget.data.featureSetList ?? [])
  .flatMap(fs => fs.features ?? []).length;
const aplus = featureCount > 0 ? 'yes' : 'no';
```

**Fallback**, if the API shape ever changes: scroll-hydrate then string-match
`cms-rpd-img` in `page.content()`. Direction of error matters here — the fallback
under-reports, so log which path produced the answer and alert if the API path
starts failing, rather than silently degrading to the weaker check.

Also record `aplusFeatureCount` alongside the yes/no. It costs nothing, and it
makes regressions obvious: a corpus-wide drop to `sets: 0` is a broken scraper,
whereas the boolean alone would look like plausible data.

### Bonus: the same API supersedes several DOM extractions

`/api/4/page/fetch` returns the whole page model — 28 widgets including
`PRODUCT_PAGE_SUMMARY_V2` (title, rating, price), `COMPOSED_PINCODE_DELIVERY`
(delivery promise), `PRODUCT_BREADCRUMBS`, `SELLER`, `COMPOSED_RATING_REVIEW`.
Given §2's finding that Flipkart's DOM has no stable selectors, this is a
materially more robust foundation than HTML scraping for §3's fields too.

I'm *not* folding that into the plan yet. It's an undocumented internal endpoint,
so it can change without notice, and JSON-LD (§2) is a public contract that
already covers title/rating/ratingCount reliably. Proposal: use the API where it
is the only good option (A+, and delivery if the DOM text proves flaky), keep
JSON-LD as primary elsewhere, and revisit going API-first once we see how stable
the endpoint is in practice.

---

## 6. Delivery promise — `delivery.ts` ports unchanged

**Verified:** the delivery block renders *without* a pincode being set:

```
Delivery details
Location not set
Select delivery location
Delivery by 21 Aug, Fri
```

`"by 21 Aug, Fri"` is day-first English, which the existing `DAY_FIRST` regex in
`delivery.ts` already parses. **The entire module ports over as-is** — the
multilingual month/weekday tables are dead weight for a single-marketplace
India-only scraper but cost nothing and keep the two codebases diffable.

The extractor changes: anchor on the "Delivery details" / "Delivery by" text
instead of Amazon's `[data-csa-c-delivery-time]` attribute and `#mir-layout-*`
ids. Read it *before* the Showcase check, same ordering rationale as Amazon
(that check scrolls the page).

Out-of-stock products show no delivery block → `null`, matching Amazon's
semantics where `0` stays reserved for same-day.

Pincode handling is covered in §6a — it is a first-run concern, not an env var.

---

## 6a. Pincode + login — handled at first run, persisted in the Chrome profile

**Decision: pincode and Flipkart login are both collected during the first-run
flow, exactly like Amazon's, and reused from the persistent Chrome profile.**

Why not automate the pincode: I tried. The "Select delivery location" control is
a `<div>` with no input behind it, and a synthetic `element.click()` does not
open the modal — Flipkart's React-Native-Web layer only responds to trusted
pointer events. There is also no `pincode` cookie or localStorage key until one
is set (verified: cookies are just `T`, `qH`, Adobe analytics; localStorage holds
only New Relic keys), so it cannot be injected either. Flipkart appears to bind
the location to the server-side session behind the `T` cookie.

That makes the human-in-the-loop first run the right answer rather than a
compromise — and it's the pattern already proven in the Amazon scraper.

**The pincode is not collected on the settings form.** It is entered on Flipkart
itself, in the same manual session as the login. A pincode typed into our form
would be a value we could store but never apply — there is no mechanism to push
it into Flipkart, per the paragraph above. Collecting it would imply a control
we don't have.

**`firstRun.ts` flow:**

1. Settings form — Email, Profile IDs (identical to Amazon's), plus a
   "What happens next" panel spelling out steps 3–4. The instructions live on
   the page because that is where the user is looking; the console gets a copy.
2. Save to `user-settings.json` → `{ emailId, profileIds, firstRunCompletedAt }`.
3. Open `https://www.flipkart.com` in the visible browser. The user logs in
   **and** sets the delivery pincode via "Select delivery location".
4. Wait for tab close (same 10-minute timeout as Amazon), then proceed.

Both the login session and the location selection live in the persistent Chrome
profile, so subsequent headless runs inherit them with no further interaction.

**Boot-time verification.** Since I could not confirm where Flipkart persists the
pincode, verification is done by reading the rendered location label on the first
product page rather than by inspecting storage: if it still shows
`Location not set`, log a loud warning that delivery promises will be
geo-guessed, and record `pincodeApplied: false` alongside the result. This fails
loudly instead of silently emitting drifting delivery numbers.

`marketplaces.ts` supplies the fallback pincode when the user leaves the field
blank (§8).

---

## 7. Best Sellers Rank — no equivalent

Flipkart publishes no BSR. Nearest signals are the breadcrumb category path
(`Home / Audio & Video / Headset / Earphones / Wireless Earphones / Neckband`)
and an unstructured "BESTSELLER" badge.

Recommendation: populate `bestSellersRank` with the breadcrumb path so the field
is non-empty and meaningful, or leave it `""`. Note it is already optional in
`ProductReviewResult` and — checking `index.ts` — **is not sent to the backend at
all** on the Amazon side, so this is cosmetic either way.

---

## 8. Marketplaces — same registry shape as Amazon

Keeping the Amazon structure verbatim, as requested. `marketplaces.ts` stays a
`Record<shortCode, Marketplace>` with `resolveMarketplace()` throwing on unknown
codes, and `index.ts` keeps calling it per query. Nothing in the multi-profile
loop or the `SCRAPE_SHORT_CODES` filter changes.

The difference is that Flipkart genuinely operates only in India, so the registry
has one live entry:

```ts
export const MARKETPLACES: Record<string, Marketplace> = {
  FKIN: { url: 'www.flipkart.com', zipcode: '110001' }
};
```

Two things worth noting:

- **`zipcode` stops being dead weight.** In the Amazon scraper the field is
  declared but never read. Here it becomes the fallback delivery pincode when the
  user leaves the first-run field blank, so precedence is:
  `user-settings.pincode` → `MARKETPLACES[shortCode].zipcode`.
- **Extensibility is preserved.** Adding Shopsy (`FKSH`) or any future Flipkart
  Group surface is a one-line registry entry plus its own URL builder, with no
  scraper changes — the same property the Amazon 16-marketplace map gives you.

If the backend ever emits Amazon short codes (`AZIN`, …) into a Flipkart profile,
`resolveMarketplace` throws and `index.ts`'s existing per-query `try/catch` logs
`[FAIL]` and moves on. No new error handling needed.

---

## 9. Auth

**Reviews are readable without login** — all recon above ran anonymously, so
scraping does not strictly require an account. Login is still part of first run
(§6a) because a logged-in session gives more stable delivery/serviceability data
and draws fewer bot challenges over long runs.

Amazon's `/ap/signin` interception and its `waitForURL(timeout: 0)` block are
dropped — Flipkart never hard-redirects a review page to a login wall. Instead,
`scraper.ts` dismisses Flipkart's login interstitial (the ✕ on the modal that
appears on some entries) where Amazon dismissed the cookie banner, and treats a
missing session as a warning rather than an error.

---

## 9a. API deferred — local input/output, wired for a one-line switch

**Decision: no backend integration for now. The API layer is built but points at
nothing until you supply URLs.**

The goal is that turning the API on later is a `.env` edit with **zero code
changes**. So the two API modules keep their exact Amazon signatures —
`fetchQueries(profileId): Promise<Query[]>` and
`postScrapedResult(result): Promise<void>` — and each picks its backend at
runtime based on whether the URL is configured:

```ts
// api/queries.ts
export async function fetchQueries(profileId: string): Promise<Query[]> {
  if (!config.queriesApiUrl) return loadLocalQueries(profileId);   // pending API
  /* ...existing fetch + Bearer token, unchanged... */
}
```

**Input when the API is off** — `queries.json` next to the executable:

```json
{
  "default": [
    { "productId": 1, "pid": "ACCGJP5QSJFP7HAP", "shortCode": "FKIN" },
    { "productId": 2, "pid": "MOBGTAGPTB3VS24W", "shortCode": "FKIN" }
  ]
}
```

Keyed by `profileId` so the multi-profile loop in `index.ts` exercises the same
code path it will use against the live API. A bare array is also accepted and
treated as the `default` profile. Missing file → clear error naming the expected
path, not a stack trace.

**Output when the API is off** — the exact JSON body that *would* have been
POSTed, appended to `results/<profileId>-<runDate>.jsonl`, one result per line,
plus a console summary. Same object, same dual snake_case/camelCase keys, so
when you do wire the endpoint you can diff a captured line against what the
backend expects before flipping the switch.

`config.ts` therefore defaults `queriesApiUrl`, `resultsApiUrl` and `apiToken` to
**empty strings** rather than carrying the Amazon production URLs and the
hardcoded token — those must not leak into this codebase. `.env.example` ships
the keys commented out with a note that filling them switches the scraper from
local to API mode.

One open item for when you do wire it up: the local schema above uses `pid`, and
whether the real endpoint expects `pid` or reuses the `asin` field is the
question from §11.1. It stays a one-line change in the row mapper either way.

---

## 10. File plan

| File | Change from Amazon |
|---|---|
| `src/browser.ts` | copy verbatim |
| `src/util.ts` | copy verbatim |
| `src/userSettings.ts` | copy verbatim |
| `src/api/queries.ts` | copy; `asin` → `pid`; local-file fallback (§9a) |
| `src/api/results.ts` | copy; JSONL fallback when URL unset (§9a) |
| `src/delivery.ts` | copy verbatim (§6) |
| `src/config.ts` | rename dirs/defaults; review-depth limits (§4); API URLs default to `''` (§9a) |
| `src/types.ts` | `asin` → `pid`; `Review` gains `location`, `verifiedPurchase`; result gains `aplusFeatureCount`, `pincodeApplied` |
| `src/pageApi.ts` | **new** — `/api/4/page/fetch` client + widget lookup helper (§5) |
| `src/marketplaces.ts` | single `FKIN` entry, same registry shape (§8) |
| `src/firstRun.ts` | copy; adds login/pincode instructions panel (§6a) |
| `src/index.ts` | copy; label changes only — loop logic identical |
| `src/extractors.ts` | **rewrite** — JSON-LD + text-anchor strategy (§2) |
| `src/scraper.ts` | **rewrite** — URL-based pagination, no auth block (§4) |
| `src/reviewParser.ts` | **new** — text-block review parser, unit-testable standalone |

`package.json` / `tsconfig.json` / `.env.example` copy across with renames.
Same pkg → `FlipkartReviewScrapper.exe` build target.

---

## 11. Decisions — settled

1. **Backend contract — deferred, with its own database.** No API integration
   now. The API layer is built with local file input/output and empty URL
   defaults; enabling it is a `.env` edit with no code change (§9a).

   **The `pid`-vs-`asin` question is settled: the field stays `pid`.** Flipkart
   gets a separate database rather than sharing Amazon's tables, so there is no
   reason to disguise a Flipkart FSN as an `asin`. `api/queries.ts` still accepts
   either name on input, so a backend that emits `asin` keeps working.
2. **Review depth — `maxReviewPages: 30` / `maxCriticalReviews: 200`**, both
   env-overridable, early-exit on an empty page (§4). Not explicitly confirmed —
   proceeding with the proposal. Say the word if you want deeper crawls, it's a
   config constant, not a design change.
3. **Pincode — set by the user on Flipkart** during the first-run login, not
   asked for on the settings form and not stored in `user-settings.json`;
   persisted in the Chrome profile and reused on later runs (§6a). No env var;
   automation of the location modal was tested and does not work.
4. **Marketplaces — Amazon registry shape kept verbatim**, single `FKIN` entry,
   `zipcode` repurposed as the fallback pincode (§8).

## 12. Risks

- **A+ detection now rests on an internal API.** The RPD rule itself is well
  evidenced (§5), but `/api/4/page/fetch` is undocumented and Flipkart can change
  it without notice. Mitigations: the `cms-rpd-img` DOM fallback, logging which
  path answered, and persisting `aplusFeatureCount` so a corpus-wide collapse to
  zero is visible rather than looking like real data.
- **Class-name churn.** Mitigated by leaning on JSON-LD and text anchors, but the
  review text-block parser is inherently coupled to Flipkart's copy ("Verified
  Purchase", "Review for:"). Isolating it in `reviewParser.ts` keeps the blast
  radius to one file with fixture-based tests.
- **Rate limiting.** Flipkart throttles harder than Amazon and 30 review pages
  per product is a lot of requests. Expect to need a per-page delay on top of
  the existing `SCRAPE_DELAY_MS` between products.
- **Pincode persistence is assumed, not proven.** I confirmed Flipkart does *not*
  store the location in a cookie or localStorage before one is set, but could not
  confirm it survives a profile restart without manually completing the flow in a
  real session. The §6a boot-time check exists precisely so this fails loudly if
  the assumption is wrong; if it turns out not to persist, the fallback is
  re-prompting per run or accepting geo-guessed promises.
