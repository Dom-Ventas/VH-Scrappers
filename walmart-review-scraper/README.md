# Walmart review scraper (`walmart-review-scrapper.exe`)

Scrapes Walmart (**www.walmart.com**) **product pages** for the listings the
VentaWiz backend asks about (`GET /v1/scrapper/review-queries`), reporting the
star rating, rating count, delivery promise and the critical (1–2 star)
reviews (`POST /v1/scrapper/reviews`).

Part of the **Walmart** bundle, alongside
[`walmart-ads-scraper/`](../walmart-ads-scraper/). Normally launched by a
Walmart build of the VentaHub agent rather than run by hand — see the
[root README](../README.md). The backend already reserves it: `walmart-reviews`
in `ventawiz/scrapper/catalog.py` names this exe and is `enabled=False` until
it ships.

**For a full step-by-step walkthrough see [HOW_TO_RUN.md](HOW_TO_RUN.md).**
This file is the quick reference.

## Run it

```bash
npm install
npm run dev-api      # one command: mock backend + live scrape of 3 products + summary
npm run dev          # from source, against the URLs in .env
npm run mock         # local mock backend on its own (port 8791)
npm run test:unit    # parsers, option picking, result mapping — no browser
npm test             # everything, including two live walmart.com products
npm run build:exe    # -> dist/walmart-review-scrapper.exe
```

First run opens a setup page for your email + VentaWiz **store IDs**, then
walmart.com so you can set a delivery ZIP / store once (and pass a "Robot or
human?" check if one appears). When the agent launches the scraper it passes
`SCRAPE_STORE_IDS`, and no setup form is shown.

## How it maps to the other review scrapers

| | Amazon | noon | **Walmart** |
| --- | --- | --- | --- |
| Identifier in the queue | ASIN | SKU | **wpid** (`243ESPUGUSOJ`) — what VentaWiz stores as `mp_product_id` for Walmart |
| Product URL | `/dp/<ASIN>` | `/<locale>/<SKU>/p/` | `/ip/<wpid>` |
| Reviews URL | `/product-reviews/<ASIN>/` | `/<locale>/reviews/<SKU>/` | `/reviews/product/<item id>?sort=rating-asc&page=N` |
| Critical filter | `?filterByStar=critical` | Sort By → Lowest Rating (click) | `sort=rating-asc` in the URL |

Walmart has two ids per product. The **wpid** opens the product page; the
numeric **item id** (`11381374703`, read off that page) is the only id the
reviews page answers to. The scraper reads both pages' Next.js data block
(`<script id="__NEXT_DATA__">`) first — product name, ids, `averageRating`,
`numberOfReviews`, price, fulfillment options with dates; per-star counts and
the page of reviews — and falls back to the visible DOM only when a field is
missing from it.

## What is sent

One POST per queue item, the same body the Amazon and noon scrapers send:

```jsonc
{
  "store_id": 13, "product_ids": [101, 102],
  "rating": 4.3, "rating_count": 86071,
  "critical_reviews": { "reviews": [
    { "rating": 1, "title": "Will Never Shop Online with Walmart Again",
      "text": "...", "author": "Debra", "date": "3/12/2026", "verifiedPurchase": true }
  ] },
  "aplus_content": null,          // Walmart has no A+ module
  "delivery_promise_days": 1,
  "item_id": "11381374703", "price": 99, "currency": "USD", "availability": "IN_STOCK"   // extras; ignored
}
```

| Field | Source on Walmart | Notes |
| --- | --- | --- |
| `rating` | `product.averageRating` | Else the "4.3 out of 5 stars" widget. A product with no ratings posts `null`, never 0. |
| `rating_count` | `product.numberOfReviews` | The ratings count ("86K ratings"), not the smaller reviews-with-text count. |
| `critical_reviews` | reviews pages, `sort=rating-asc` | 1–2 star reviews with text, 10 per page, stopping at the first page that passes 2 stars, at `MAX_CRITICAL_REVIEWS`, or at Walmart's own 1+2 star count. Walmart shuffles tied reviews between loads, so each is kept once by its `reviewId` (posted with the review). |
| `delivery_promise_days` | `product.fulfillmentOptions[]` | SHIPPING and same-day DELIVERY only, pickup ignored, earliest wins — the ads scraper's rule. Badge text first ("Tomorrow", "Thu, Oct 15", "3+ days"), then `slaDayEnum`, then the ISO date. Else the visible "How you'll get this item" tiles. |
| `aplus_content` | — | Always `null`. |

An unknown wpid gets Walmart's "This page could not be found" page (with an
empty product object); that is a permanent failure, reported once as `[FAIL]`
and not retried.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (`src/embedded.ts`) | VentaWiz server root |
| `QUERIES_API_URL` | `${VH_API_ROOT}/v1/scrapper/review-queries` | Where to fetch the product queue |
| `RESULTS_API_URL` | `${VH_API_ROOT}/v1/scrapper/reviews` | Where to post results |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated store ids; set by the agent |
| `SCRAPE_MARKETPLACE` | `walmart` | Sent as `marketplace=` on the queue request |
| `VW_AUTH_URL` | `http://localhost:8100` (baked in by CI) | VentaWiz auth service root; tokens come from `POST /v1/token` |
| `VW_CLIENT_ID` | — (the agent passes it) | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | — (the agent passes it) | Its secret, `vws_…`. Never baked into the exe |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\WalmartReviewScrapper\chrome-profile` | Chrome profile holding the location / bot-check cookies |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `WMUS` |
| `MAX_CRITICAL_REVIEWS` | `100` | Cap per product; 10 reviews per page load |
| `REVIEW_PAGE_DELAY_MS` | `2000` | Pause between review pages of one product |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between products |
| `DEFAULT_WALMART_DOMAIN` | `www.walmart.com` | Host opened on first run |

These defaults come from `src/embedded.ts`, with the token and API root
injected at build time by CI. The agent still overrides all three from the
backend's assignment when it launches this scraper.

## Marketplaces

Defined in [`src/marketplaces.ts`](src/marketplaces.ts) — the same table as the
ads scraper. VentaWiz hands this scraper every store whose code starts with
`WM`; today that is `WMUS` only.

## Bot check

Walmart serves a "Robot or human?" press-and-hold page (PerimeterX)
intermittently, per session. Each page load recognises it by its title and
wording (not by the hidden `#px-captcha` element, which sits on normal pages
too), polls up to 45 s for it to clear, reloads once, and only then fails the
product with `BlockedError`. After a blocked product the scraper waits an
extra 60 s; after three in a row it ends the cycle and leaves the rest of the
queue for the next one. A product also costs up to 1 + `MAX_CRITICAL_REVIEWS`/10
page loads, which is why the cap defaults to 100 and not 200.

## Output markers

`[OK]` / `[FAIL]` per product and a final `[DONE]`, parsed by the agent to
classify the run. `[BLOCK]`, `[REVIEWS]` and `[RETRY]` lines are diagnostics.

## Still to wire up outside this folder

1. **Backend:** flip `walmart-reviews` to `enabled=True` in
   `VentaWiz-Backend/src/ventawiz/scrapper/catalog.py` once the exe ships.
2. **Agent:** a `walmart` kind in `ventahub-agent` (shared with the ads scraper).
3. **CI:** add `walmart-review-scraper` to the scraper loop and the release
   file list in `.github/workflows/build-windows-agent.yml`.
