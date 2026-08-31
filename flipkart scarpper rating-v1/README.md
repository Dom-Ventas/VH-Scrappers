# Flipkart Review Scraper

Flipkart counterpart to the Amazon review scraper. Same module layout, same
first-run/settings/profile flow, same result payload — only the extraction layer
is Flipkart-specific. See [PLAN.md](PLAN.md) for why each field is sourced the
way it is.

## Scraped fields

| Field | Source |
|---|---|
| `rating`, `ratingCount` | product JSON-LD `aggregateRating` |
| `criticalReviews` | `REVIEWS` widgets, most-recent-first, filtered to 1–2 star |
| `aplus_content` | `"yes"` / `"no"` — Rich Product Description present |
| `delivery_promise_days` | "Delivery by 21 Aug, Fri" → days from today |

Each critical review carries the same five fields the Amazon scraper emits —
`rating`, `title`, `text`, `author`, `date` — plus `location`, `dateDays`,
`verifiedPurchase`, `helpfulCount` and `reviewId`:

```json
{ "rating": 1, "title": "Horrible",
  "text": "Extremely slow. Its a namesake Sony TV. I went for the brand, should have picked up some other brand.",
  "author": "Roshan Joseph", "location": "Mumbai", "date": "5 days ago",
  "dateDays": 5, "verifiedPurchase": true, "helpfulCount": 0,
  "reviewId": "…", "truncated": false }
```

**Review messages come back in full.** The rendered page clips long bodies with
a "...more" control that ignores synthetic clicks, so the DOM can only ever
yield a truncated message; the widget data has none of that. Anything captured
by the DOM fallback is flagged `truncated: true` rather than passed off as
complete.

Products are identified by **PID** (`ACCGJP5QSJFP7HAP`), Flipkart's ASIN
equivalent. It appears as `pid=` in any product URL.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
cp queries.example.json queries.json
```

## Run

```bash
npm run dev
```

The first run opens a visible browser and asks for your email and profile IDs.
It then opens Flipkart, where you **log in and set your delivery pincode by
hand** in that same session. Both persist in the Chrome profile and are reused
headlessly on later runs.

The pincode is not a field on the setup form on purpose — it only takes effect
when set on Flipkart itself, so a value typed into our form would be stored but
never applied (PLAN.md §6a).

### `pincodeApplied: false` — what it means

`false` means Flipkart is showing "Location not set", so delivery promises are
geo-guessed rather than measured from your pincode. `null` means the page did
not render enough to tell. Neither invalidates the other fields — ratings,
reviews and A+ are unaffected.

It reports `false` when the pincode was never set, or did not persist. Fix it
any time with:

```bash
npm run setup        # or: FlipkartReviewScrapper.exe --setup
```

That reopens the visible browser for the login/pincode step and then **reads
back whether the location actually stuck**, so a setup that silently failed is
reported instead of quietly degrading every later run. First-run only fires when
settings are missing, so this is the way to redo it.

```bash
npm test        # parser checks against a real captured review page
npm run build   # tsc
npm run build:exe
```

## Backend API

Configured in `.env`. Flipkart has its own endpoint pair, separate from the
Amazon scraper's:

```
API_TOKEN=<token>
QUERIES_API_URL=https://<host>/backend/api/v1/scrapper/flipkart/review-queries
RESULTS_API_URL=https://<host>/backend/api/v1/scrapper/flipkart/reviews
```

Queries are fetched per profile ID; each scraped product is POSTed as one JSON
body. `api/queries.ts` accepts either `pid` or `asin` on the way in, so it works
whichever field name the backend emits.

**Blanking all three runs the scraper with no server at all** — queries are read
from `queries.json` and results written to `results/<profileId>-<date>.jsonl`,
one JSON object per line, byte-identical to what would have been POSTed. Useful
for scraping or debugging offline.

```json
{
  "default": [
    { "productId": 1, "pid": "ACCGJP5QSJFP7HAP", "shortCode": "FKIN" }
  ]
}
```

If the backend is unreachable the run fails loudly with the cause
(`ECONNREFUSED`, DNS, timeout, TLS) rather than a stack trace, and never
silently falls back to local files — a misconfigured URL should not look like a
successful run.

## Review depth

Flipkart has no server-side critical-review filter — `rating=1` in the URL is
accepted and silently ignored, and the star histogram is display-only. Reviews
are pulled 10 per page most-recent-first and filtered locally, so coverage is
bounded by:

```
MAX_REVIEW_PAGES=30       # pages scanned per product
MAX_CRITICAL_REVIEWS=200  # stop once this many are collected
```

Raising these raises per-product runtime roughly linearly. When the page limit
stops a crawl early the run logs it, so partial coverage is never silent.
