# eBay review scraper (`ebay-review-scrapper.exe`)

Scrapes eBay **listing and product-review pages** (www.ebay.com, .co.uk, .de,
.com.au) for the listings the VentaWiz backend asks about
(`GET /v1/scrapper/review-queries`), reporting the star rating, rating count,
delivery estimate and the critical (1–2 star) reviews (`POST /v1/scrapper/reviews`).

Part of the **eBay** bundle, alongside
[`ebay-ads-scraper/`](../ebay-ads-scraper/). Normally launched by an eBay
build of the VentaHub agent rather than run by hand — see the
[root README](../README.md). The backend does **not** know eBay as a scraper
marketplace yet; see [Still to wire up](#still-to-wire-up-outside-this-folder).

**For a full step-by-step walkthrough see [HOW_TO_RUN.md](HOW_TO_RUN.md).**

## Run it

```bash
npm install
npm run dev-api      # one command: mock backend + live scrape of 4 listings + summary
npm run dev          # from source, against the URLs in .env
npm run mock         # local mock backend on its own (port 8791)
npm run test:unit    # parsers, page readers on captured markup, result mapping — no network
npm test             # everything, including three live ebay.com listings
npm run build:exe    # -> dist/ebay-review-scrapper.exe
```

## How it maps to the other review scrapers

| | Amazon | Walmart | **eBay** |
| --- | --- | --- | --- |
| Identifier in the queue | ASIN | wpid | **item number** (`265983500898`) — what VentaWiz stores as `mp_product_id` for eBay |
| Product URL | `/dp/<ASIN>` | `/ip/<wpid>` | `/itm/<item>` |
| Reviews URL | `/product-reviews/<ASIN>/` | `/reviews/product/<item id>` | `/urw/product-reviews/<epid>?_itm=<item>&sort=%2Brating&pgn=N` |
| Critical filter | `?filterByStar=critical` | `sort=rating-asc` | `sort=+rating` ("Ratings: lowest first") |

eBay's star reviews belong to the **catalogue product** (epid) a listing is
matched to, not to the listing — every seller of the same product shows the
same ones. The epid comes from the listing page's own "See all reviews" link.

**Listings without a catalogue product** (no-name items, eBay Refurbished
listings) have no star reviews on eBay, only seller feedback
(positive/neutral/negative). That is deliberately **not** sent: they post
`rating: null`, `rating_count: null`, an empty review list — and still the
delivery estimate.

## What is sent

```jsonc
{
  "store_id": 13, "product_ids": [101],
  "rating": 4.5, "rating_count": 72,
  "critical_reviews": { "reviews": [
    { "reviewId": "10000000335385089", "rating": 1, "title": "One of the earbuds is not working proper...",
      "text": "...", "author": "vcram_95", "date": "Jul 14, 2026", "verifiedPurchase": true }
  ] },
  "aplus_content": null,          // eBay has no A+ module
  "delivery_promise_days": 2,
  "epid": "17054784938", "price": 16.34, "currency": "USD"   // extras; ignored
}
```

| Field | Source on eBay | Notes |
| --- | --- | --- |
| `rating` | reviews page `aggregateRating` → `ratingValue` | The product's average across all sellers. |
| `rating_count` | `aggregateRating` → `reviewCount` | "72 product ratings". |
| `critical_reviews` | reviews pages sorted lowest first | 1–2★, 10 per page; stops past 2★, at the histogram's 1+2★ count, or at `MAX_CRITICAL_REVIEWS`. The pinned "TOP CRITICAL/FAVORABLE" reviews are ignored for the stop and de-duplicated by review id. |
| `delivery_promise_days` | listing's "Delivery:" row, else "Shipping:" row | Earliest date of "Estimated between Fri, Oct 16 and Tue, Oct 20"; handling-time sentences are cut off. Depends on the profile's "Shipping to" location. |
| `aplus_content` | — | Always `null`. |

An unknown item number gets eBay's "Looks like this page is missing"; that is
a permanent failure, reported once as `[FAIL]` and not retried.

Verified live 2026-10-14: AirPods Pro 2 — 82 of 82 critical reviews over 9
pages; Skullcandy Sesh — 4.5 / 72, 7 of 7; ebay.de Sony XM5 — 4.7 / 154, 7 of
7; no-catalogue earbuds — nulls, delivery 3 days; unknown item — `[FAIL]`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (`src/embedded.ts`) | VentaWiz server root |
| `QUERIES_API_URL` | `${VH_API_ROOT}/v1/scrapper/review-queries` | Where to fetch the listing queue |
| `RESULTS_API_URL` | `${VH_API_ROOT}/v1/scrapper/reviews` | Where to post results |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated store ids; set by the agent |
| `SCRAPE_MARKETPLACE` | `ebay` | Sent as `marketplace=` on the queue request |
| `VW_AUTH_URL` | `http://localhost:8100` (baked in by CI) | VentaWiz auth service root; tokens come from `POST /v1/token` |
| `VW_CLIENT_ID` | — (the agent passes it) | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | — (the agent passes it) | Its secret, `vws_…`. Never baked into the exe |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\EbayReviewScrapper\chrome-profile` | Chrome profile holding the ship-to location / bot-check cookies |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `EBUS,EBDE` |
| `MAX_CRITICAL_REVIEWS` | `100` | Cap per listing; 10 reviews per page load |
| `REVIEW_PAGE_DELAY_MS` | `2000` | Pause between review pages of one listing |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between listings |
| `DEFAULT_EBAY_DOMAIN` | `www.ebay.com` | Host opened on first run |

## Marketplaces

Same table as the ads scraper ([`src/marketplaces.ts`](src/marketplaces.ts)):
`EBUS` ebay.com, `EBUK` ebay.co.uk, `EBDE` ebay.de, `EBAU` ebay.com.au.
**Check these codes against the real `com_marketplace` rows** before go-live.

## Output markers

`[OK]` / `[FAIL]` per listing and a final `[DONE]`, parsed by the agent.
`[BLOCK]`, `[REVIEWS]` and `[RETRY]` lines are diagnostics.

## Still to wire up outside this folder

1. **Backend:** VentaWiz has no eBay scraper marketplace — add `EBAY` (prefix
   `EB`) to `ScraperMarketplace` in
   `VentaWiz-Backend/src/ventawiz/scrapper/catalog.py`, plus an
   `ebay-reviews` catalog entry naming `ebay-review-scrapper.exe` (and
   `ebay-ads` for the ads scraper). Until then `marketplace=ebay` is rejected.
2. **Agent:** an `ebay` kind in `ventahub-agent` (shared with the ads scraper).
3. **CI:** add `ebay-review-scraper` to `.github/workflows/build-windows-agent.yml`.
