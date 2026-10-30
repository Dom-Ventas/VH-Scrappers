# eBay Review Scrapper — How to run

Same architecture, same payload contract and same commands as the Amazon and
noon/Walmart review scrapers, and the same folder layout as the eBay ads
scraper next door. The eBay-specific parts are in the last sections.

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

Boots the mock backend, scrapes the listings in `mock/queries.json` on live
eBay, prints a per-product summary, then shuts down. The seed holds a
catalogue-matched listing (ebay.com), a listing without a catalogue product,
an ebay.de listing and one unknown item number, so every path runs —
including the `[FAIL]` one.

It stays out of your way: the Chrome profile goes to `.dev-profile/`, not your
real `%LOCALAPPDATA%` one. On a new machine, set "Shipping to" in that
profile once (or copy `../ebay-ads-scraper/.dev-profile/` over it) — see
[Shipping location](#shipping-location). `user-settings.json` is seeded there so the run never
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
| `GET  /v1/scrapper/review-queries?store_id=13&marketplace=ebay&page=1&limit=100` | Serves the seed list from `mock/queries.json` |
| `POST /v1/scrapper/reviews` | Validates + stores a result (200 list / 404 unknown product id / 422) |
| `GET  /v1/scrapper/reviews` | Everything received this session |
| `GET  /health` | Liveness |

The port is 8791 (the ads mocks use 8789); override with `MOCK_PORT`.
The mock also serves `POST /v1/token`, handing out a token for any `svc_…`/`vws_…` pair, and refuses scrapper requests that carry no bearer token (401).

`mock/queries.json` rows are `{ store_id, short_code, mp_product_id, product_ids }`
— `mp_product_id` is the eBay **item number**. It is re-read per request.
Accepted results are written to `mock/received/<store_id>_<item>.json`, and a product rated this
session drops out of the queue, as on VentaWiz.

## Running in dev mode

```
npm run dev
```

- On the very first run, a Chrome window opens showing the Email ID / Store
  IDs form. Fill it in and click **Save and continue**.
- Chrome then navigates to an ebay.com search. Click **Shipping to** in the
  left column and set the marketplace's country and postcode — the listing's
  delivery estimate is computed for it. Repeat on each eBay site the stores
  sell on. Signing in is optional.
- Close the eBay tab when done — the scraper will continue automatically.

Override the delays while developing:
```
SCRAPE_DELAY_MS=2000 MAX_CRITICAL_REVIEWS=20 npm run dev
```

## Running the tests

```
npm run test:unit   # no network: parsers, page readers on captured markup, result mapping
npm test            # everything, incl. three live ebay.com listings
```

To keep the live tests off your real profile:
```
SCRAPER_PROFILE_DIR="$PWD/.dev-profile" npm test
```

## Building the single-file .exe

```
npm run build:exe
```

Output: `dist/ebay-review-scrapper.exe` — the name the backend's
`ebay-reviews` catalog entry should name once it exists. It uses the persistent profile at
`%LOCALAPPDATA%\EbayReviewScrapper\chrome-profile`. Google Chrome must be
installed on the machine.

## Resetting the first-run state

Delete `%LOCALAPPDATA%\EbayReviewScrapper\chrome-profile` (or just the
`user-settings.json` inside it) and the next run shows the onboarding form again.

---

## Payload contract (VentaWiz)

One `POST /v1/scrapper/reviews` per queue item:

```json
{ "store_id": 13, "product_ids": [101, 102],
  "rating": 4.5, "rating_count": 72,
  "critical_reviews": { "reviews": [ { "reviewId": "10000000335385089", "rating": 1, "title": "...",
                                        "text": "...", "author": "vcram_95", "date": "Jul 14, 2026",
                                        "verifiedPurchase": true } ] },
  "aplus_content": null, "delivery_promise_days": 2,
  "epid": "17054784938", "price": 16.34, "currency": "USD" }
```

- `product_ids` are posted back exactly as the queue handed them out; the
  backend writes one `focused_sku_rating` row per id, all or nothing.
- A product with no ratings posts `rating: null`, never 0.
- `epid`, `price` and `currency` are eBay extras the backend ignores (the
  endpoint allows unknown fields).
- A listing with no catalogue product posts `rating: null`, `rating_count:
  null` and an empty review list — eBay has no star reviews for it — but
  still posts `delivery_promise_days`.

## Listings, products and where reviews live

The queue hands out eBay **item numbers** (`mp_product_id`, e.g.
`265983500898`) — one listing by one seller. eBay's star reviews do not
belong to the listing but to the **catalogue product** it is matched to (the
epid, `17054784938`): every seller of the same product shows the same rating
and reviews. The listing page links to them as
`/urw/<slug>/product-reviews/<epid>?_itm=<item>`; the scraper takes the epid
from that link (only a link carrying our own `_itm`).

A listing that is not matched to a catalogue product — common for no-name
items, and for eBay Refurbished listings even when the search card shows
stars — has **no star reviews on eBay at all**, only seller feedback
(positive / neutral / negative). Seller feedback is deliberately not sent;
such listings post nulls plus the delivery estimate.

## Critical reviews

`/urw/product-reviews/<epid>?_itm=<item>&sort=%2Brating&pgn=N` lists the
product's reviews lowest rating first, 10 per page, as schema.org microdata.
Page 1 also carries the aggregate (`ratingValue`, `reviewCount`) and the
per-star histogram. The harvest stops at the first page that passes 2 stars,
at the histogram's 1+2 star count, at `MAX_CRITICAL_REVIEWS`, or at the last
page. eBay pins one "TOP CRITICAL" and one "TOP FAVORABLE" review above the
list whatever the sort (`data-type`); they never decide the stop, and reviews
are de-duplicated by eBay's review id.

Verified 2026-10-14: AirPods Pro 2 (147555800793, 559 ratings) — 82 of 82
critical reviews over 9 pages; Skullcandy (72 ratings) — 7 of 7 on one page;
ebay.de Sony XM5 (154 ratings) — 7 of 7, German "Bestätigter Kauf: Ja" read.

## Delivery promise

From the listing's **Delivery:** row ("Estimated between Fri, Oct 16 and Tue,
Oct 20 to 10001"), or the **Shipping:** row when a listing has none ("Free 2-4
day delivery Get it between Fri, Oct 16 and Mon, Oct 19 to 10001."). The
earliest date wins. The cell runs on with handling-time sentences ("Seller
ships within 1 day", "Verkäufer verschickt innerhalb von 1 Tag") that are cut
off before parsing.

## Shipping location

eBay computes the estimate for the session's **"Shipping to"** location,
which defaults to the machine's IP country and is stored per eBay site in the
Chrome profile. Shipped to India, the ebay.de Sony listing estimates 27 days.
Set it on first run, or later with `BROWSER_VISIBLE=1 npm run dev`: open the
site, search anything, click **Shipping to** in the left column.

## When eBay changes its pages

All selectors and the in-page readers live in `src/extractors.ts`. Check a
listing end to end with:

```
npx tsx scripts/inspect-result.ts 265983500898
npx tsx scripts/inspect-result.ts 278359701353 EBDE
```

## Bot check

eBay runs Akamai Bot Manager ("Pardon Our Interruption…"). None appeared in
development. Each page load recognises it by title/wording, polls up to 45 s,
reloads once, then fails the listing with `BlockedError`; the scraper backs
off an extra 60 s after a block and ends the cycle after three blocked
listings in a row (they stay due). A listing costs 1 + up to
`MAX_CRITICAL_REVIEWS`/10 page loads.
