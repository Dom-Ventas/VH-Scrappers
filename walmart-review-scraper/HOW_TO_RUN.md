# Walmart Review Scrapper — How to run

Same architecture, same payload contract and same commands as the Amazon and
noon review scrapers, and the same folder layout as the Walmart ads scraper
next door. The Walmart-specific parts are in the last sections.

## One-time setup (developer)

1. Install **Node.js 20 LTS** from <https://nodejs.org>.
2. Install **Google Chrome**. The scraper drives the installed Chrome; it does
   not download Chromium.
3. Open a terminal in this folder and run:
   ```
   npm install
   cp .env.example .env
   ```
4. Edit `.env` and set `VH_API_ROOT` (the VentaWiz server root) and the service account: `VW_AUTH_URL`, `VW_CLIENT_ID` (`svc_…`), `VW_CLIENT_SECRET` (`vws_…`).
   The endpoint URLs default to `${VH_API_ROOT}/v1/scrapper/review-queries`
   and `…/reviews`; `QUERIES_API_URL` / `RESULTS_API_URL` override them.

## Testing end to end (one command)

```
npm run dev-api
```

Boots the mock backend, scrapes the products in `mock/queries.json` on live
walmart.com, prints a per-product summary, then shuts down. The seed holds two
real products and one unknown wpid, so the `[FAIL]` path is exercised too.

It stays out of your way: the Chrome profile goes to `.dev-profile/`, not your
real `%LOCALAPPDATA%` one. `user-settings.json` is seeded there so the run never
stops at the first-launch form, the API URLs/token are passed as env vars that
override `.env` for that run only, and `MAX_CRITICAL_REVIEWS` is lowered to 20
to keep the loop quick.

## Running the mock backend on its own

```
npm run mock     # terminal 1 — http://127.0.0.1:8791
npm run dev      # terminal 2
```

For this, point `.env` at the mock:

```
QUERIES_API_URL=http://127.0.0.1:8791/v1/scrapper/review-queries
RESULTS_API_URL=http://127.0.0.1:8791/v1/scrapper/reviews
VW_AUTH_URL=http://127.0.0.1:8791
VW_CLIENT_ID=svc_dev
VW_CLIENT_SECRET=vws_dev
```

| Route | Purpose |
| --- | --- |
| `GET  /v1/scrapper/review-queries?store_id=13&marketplace=walmart&page=1&limit=100` | Serves the seed list from `mock/queries.json` |
| `POST /v1/scrapper/reviews` | Validates + stores a result (200 list / 404 unknown product id / 422) |
| `GET  /v1/scrapper/reviews` | Everything received this session |
| `GET  /health` | Liveness |

The port is 8791 (the Walmart ads mock uses 8789); override with `MOCK_PORT`.
The mock also serves `POST /v1/token`, handing out a token for any `svc_…`/`vws_…` pair, and refuses scrapper requests that carry no bearer token (401).

`mock/queries.json` rows are `{ store_id, short_code, mp_product_id, product_ids }`
— `mp_product_id` is the **wpid**. It is re-read per request. Accepted results
are written to `mock/received/<store_id>_<wpid>.json`, and a product rated this
session drops out of the queue, as on VentaWiz.

## Running in dev mode

```
npm run dev
```

- On the very first run, a Chrome window opens showing the Email ID / Store
  IDs form. Fill it in and click **Save and continue**.
- Chrome then navigates to walmart.com. Set your delivery ZIP / store in the
  header ("Pickup or delivery?") — the delivery promise depends on it — and
  complete a "Robot or human?" check if one appears. Signing in is optional.
- Close the Walmart tab when done — the scraper will continue automatically.

Override the delays while developing:
```
SCRAPE_DELAY_MS=2000 MAX_CRITICAL_REVIEWS=20 npm run dev
```

## Running the tests

```
npm run test:unit   # no browser: parsers, fulfillment option picking, result mapping
npm test            # everything, incl. two live walmart.com products
```

To keep the live tests off your real profile:
```
SCRAPER_PROFILE_DIR="$PWD/.dev-profile" npm test
```

## Building the single-file .exe

```
npm run build:exe
```

Output: `dist/walmart-review-scrapper.exe` — the name the backend's
`walmart-reviews` catalog entry expects. It uses the persistent profile at
`%LOCALAPPDATA%\WalmartReviewScrapper\chrome-profile`. Google Chrome must be
installed on the machine.

## Resetting the first-run state

Delete `%LOCALAPPDATA%\WalmartReviewScrapper\chrome-profile` (or just the
`user-settings.json` inside it) and the next run shows the onboarding form again.

---

## Payload contract (VentaWiz)

One `POST /v1/scrapper/reviews` per queue item:

```json
{ "store_id": 13, "product_ids": [101, 102],
  "rating": 4.3, "rating_count": 86071,
  "critical_reviews": { "reviews": [ { "rating": 1, "title": "...", "text": "...",
                                        "author": "Debra", "date": "3/12/2026", "verifiedPurchase": true } ] },
  "aplus_content": null, "delivery_promise_days": 1,
  "item_id": "11381374703", "price": 99, "currency": "USD", "availability": "IN_STOCK" }
```

- `product_ids` are posted back exactly as the queue handed them out; the
  backend writes one `focused_sku_rating` row per id, all or nothing.
- A product with no ratings posts `rating: null`, never 0.
- `item_id`, `price`, `currency` and `availability` are Walmart extras the
  backend ignores (the endpoint allows unknown fields).

## The two Walmart ids

The queue's `mp_product_id` is the **wpid** (`243ESPUGUSOJ`), the id VentaWiz
keys Walmart listings by. `walmart.com/ip/<wpid>` opens the product page
directly, and its data block carries the numeric **item id** (`usItemId`,
`11381374703`) plus the canonical URL. The reviews page answers only to the
item id — `/reviews/product/<wpid>` returns an empty page — so the scraper
always reads the product page first.

The wpid product page's visible ratings widget can say "(No ratings yet)"
while its data block still carries the real rating; the data block is read
first for exactly this reason. Should both be empty, the scraper follows the
page's canonical URL once and reads again.

## Critical reviews

`/reviews/product/<item id>?sort=rating-asc&page=N` lists reviews 10 per page,
1-star first. The scraper keeps reviews rated 1 or 2 and stops at the first
page that holds a 3-star or better review, at `MAX_CRITICAL_REVIEWS`, at
Walmart's own count of 1+2 star reviews with text, or at the last page. Each
review carries rating, title, text, author nickname, date and whether Walmart
badged it "Verified Purchase".

Walmart's rating-ascending order is **not stable between page loads**: tied
1-star reviews come back shuffled, so page 2 can repeat part of page 1 (4 of
10 in one measurement) and two runs of the same product collect different
reviews. Each review is therefore kept once, by Walmart's `reviewId`, which is
posted with the review so repeats can be told apart downstream too. The
`date` is Walmart's `reviewSubmissionTime` (`3/12/2026`), not the wording the
page displays.

Every review page is a page load, and every page load is a roll of the dice
with Walmart's bot check — so the cap defaults to 100 (10 pages), with a 2 s
pause between pages.

## Delivery promise

The product data lists up to three fulfillment options. Only **SHIPPING** and
same-day **DELIVERY** count (PICKUP is not delivery), an out-of-stock option is
skipped, and the earliest wins. Per option: the badge text Walmart prints
("Tomorrow", "Thu, Oct 15", "3+ days"), then `slaDayEnum` (`TODAY` /
`TOMORROW`), then an express SLA in minutes (= today), then the ISO
`deliveryDate`. When the data block has no options, the visible "How you'll get
this item" tiles are parsed the same way.

The promise depends on the ZIP / store the session resolved to; set it once on
the first run and Walmart remembers it in the Chrome profile.

## When Walmart changes its pages

Readers live in `src/extractors.ts`: the data-block shapes (`WalmartProductData`,
`WalmartReviewsData`) and the DOM fallbacks (`SELECTORS`). To re-check a
product after a change:

```
npx tsx scripts/inspect-result.ts 243ESPUGUSOJ
```

It prints everything extracted plus the first three critical reviews.

## Bot check

Same handling as the ads scraper: the "Robot or human?" page is recognised by
title and wording only, polled up to 45 s to clear, reloaded once, then failed
with a `BlockedError`. After a blocked product the scraper backs off 60 s;
after three in a row it ends the cycle. If a laptop is blocked repeatedly, run
once with `BROWSER_VISIBLE=1`, complete the check in the scraper's Chrome
window, and raise `SCRAPE_DELAY_MS`.
