# eBay ads scraper (`ebay-search-term-scrapper.exe`)

Scrapes eBay **search-result pages** (www.ebay.com, .co.uk, .de, .com.au) for
search terms supplied by the VentaWiz backend
(`GET /v1/scrapper/search-term-queries`), reporting the sponsored (Promoted
Listings) and organic products found on page one
(`POST /v1/scrapper/search-term-results`).

Part of the **eBay** bundle. Normally launched by an eBay build of the VentaHub
agent rather than run by hand — see the [root README](../README.md). The
backend does **not** know eBay as a scraper marketplace yet; see
[Still to wire up](#still-to-wire-up-outside-this-folder).

**For a full step-by-step walkthrough see [HOW_TO_RUN.md](HOW_TO_RUN.md).**
This file is the quick reference.

## Run it

```bash
npm install
npm run dev-api      # one command: mock backend + full live scrape + summary
npm run dev          # from source, against the URLs in .env
npm run mock         # local mock backend on its own (port 8789)
npm run test:unit    # parsers, result mapping, sponsored probe/retry — no network
npm test             # everything, including two live ebay.com searches
npm run build:exe    # -> dist/ebay-search-term-scrapper.exe
```

First run opens a setup page for your email + VentaWiz **store IDs** (positive
integers), then ebay.com so you can set **"Shipping to"** once per eBay site
(see [Shipping location](#shipping-location-matters)). When the agent launches
the scraper it passes `SCRAPE_STORE_IDS`, and no setup form is shown.

Each run fetches the whole queue for those stores once (paged, up to 50 store
ids per request), scrapes every term, and posts one result per term — up to 5
sponsored + 5 organic, missing values `null`. An empty `products` is still
posted. A 409 ("already scraped today") counts as success.

## What is sent

```jsonc
{
  "store_id": 13, "search_term": "bluetooth headphones",
  "products": [
    { "position": 1, "mp_product_id": "405424132378", "is_sponsored": true,
      "price": "USD 14.99", "rating": null, "review_count": null,
      "delivery_days": null, "title": "Bluetooth 5.0 Earphones Charging Case ..." }
  ]
}
```

| Field | Source on eBay's card (`ul.srp-results > li[data-listingid]`) | Notes |
| --- | --- | --- |
| `mp_product_id` | `data-listingid` | eBay's **item number** — what VentaWiz stores for eBay listings (`mp_product_id` = "item_number (ebay)"). The same number opens `/itm/<id>` on every eBay site. |
| `is_sponsored` | the *painted* "Sponsored"/"Anzeige" label | Every card carries the label; see below. |
| `title` | `.s-card__title` spans | The `.clipped` "Opens in a new window or tab" and a "NEW LISTING" badge are left out. |
| `price` | first `.s-card__price` | Lower bound of a "$8.89 to $10.49" range; the struck-through list price is a different element. Re-emitted as `USD 8.89` / `EUR 16.57`. |
| `rating` | `.x-star-rating` "4.5 out of 5 stars." | Catalogue-level — only on cards linked to an eBay product page (~4 of 20). |
| `review_count` | `.s-card__reviews-count` "72 product ratings" | Same cards as `rating`. "851 sold" / watchers / seller feedback are never read as reviews. |
| `delivery_days` | the attribute row that talks about delivery | eBay often prints only a cost ("Free delivery", "+$20.00 delivery") — that is `null` days. "Free delivery in 2-3 days" → `2`. |

Measured on `bluetooth headphones` (www.ebay.com, ship-to 10001, top 20):
20/20 item number, title and price; 4/20 rating and review count; 20/20
delivery text, 5/20 with a date; 8/20 sponsored.

## Sponsored detection

eBay hides its ad label from scrapers on purpose. **Every** card — ad or
organic — has the same `.s-card__sep > b` element with:

- a `background-image: url(data:image/svg+xml;base64,…)` whose `<text>` spells
  "Sponsored" with Cyrillic homoglyphs and bidi marks (`Sрonsor⁧ed`);
- a transparent decoy span reading `derosnopS`;
- `aria-labelledby` ids that resolve to "Sponsored", "SponsoredSponsored" or
  nothing, **uncorrelated** with being an ad (agreed with the visible label on
  15/30 cards of one query).

The only difference a human can see is *where the SVG draws its text*: on an
ad the `x/dx/translate` offsets net to about `(0, 12)`, inside the 65×15 box;
on an organic card they net somewhere off-canvas (`(-46, 39)`, `(35, -37)`,
`(105, 108)` — it changes per page). So `src/extractors.ts` asks the browser:
it draws the label SVG onto a canvas the size of the element and counts
painted pixels. Painted = sponsored. If the canvas can't be read it falls back
to summing the offsets itself.

```
npx tsx scripts/check-sponsored.ts "bluetooth headphones"
npx tsx scripts/check-sponsored.ts "yoga mat" --short-code=EBDE
```

prints, per card, the canvas verdict, the offset verdict and the (decoy) aria
verdict. Verified 2026-10-14: canvas == offsets on every card of four US terms,
one DE and one UK term — 7–10 ads in each top 20, confirmed against
screenshots. `npm test` asserts sponsored is neither 0 nor all 20, and the
scraper logs `SUSPECT:` if every card comes back sponsored (the failure mode a
naive "is there a Sponsored element?" check hits on eBay).

Also excluded: hidden decoy cards (`div.s-clipped[aria-hidden] > li`, "Shop on
eBay", `/itm/123456`) that sit outside the results list.

## Shipping location matters

eBay picks which listings to show — not just the delivery cost — from the
session's **"Shipping to"** location, and defaults it to the machine's own
country. From an Indian IP, ebay.com showed *"0 results"* for `vintage pyrex
bowl` until the location was set to a US ZIP, then 36,000+. The location is
stored **per eBay site** in the Chrome profile (`nonsession` cookie), so a
laptop scraping ebay.com and ebay.de needs it set on both. The first-run flow
opens ebay.com for this; for another site, open it in the scraper's window
(`BROWSER_VISIBLE=1`) and set "Shipping to" in the left column of any search.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VH_API_ROOT` | `http://localhost:8000` (`src/embedded.ts`) | VentaWiz server root |
| `QUERIES_API_URL` | `${VH_API_ROOT}/v1/scrapper/search-term-queries` | Where to fetch search terms |
| `RESULTS_API_URL` | `${VH_API_ROOT}/v1/scrapper/search-term-results` | Where to post results |
| `SCRAPE_STORE_IDS` | *(from `user-settings.json`)* | Comma-separated store ids; set by the agent |
| `SCRAPE_MARKETPLACE` | `ebay` | Sent as `marketplace=` on the queue request |
| `VW_AUTH_URL` | `http://localhost:8100` (baked in by CI) | VentaWiz auth service root; tokens come from `POST /v1/token` |
| `VW_CLIENT_ID` | — (the agent passes it) | VentaWiz service account client id, `svc_…` |
| `VW_CLIENT_SECRET` | — (the agent passes it) | Its secret, `vws_…`. Never baked into the exe |
| `SCRAPER_PROFILE_DIR` | `%LOCALAPPDATA%\EbaySearchTermScrapper\chrome-profile` | Chrome profile holding the ship-to location / bot-check cookies |
| `SCRAPE_SHORT_CODES` | *(all)* | Optional local filter on `short_code`, e.g. `EBUS,EBDE` |
| `BROWSER_VISIBLE` | `0` | `1` shows the browser window |
| `SCRAPE_DELAY_MS` | `30000` | Pause between queries |
| `DEFAULT_EBAY_DOMAIN` | `www.ebay.com` | Host opened on first run |

## Marketplaces

Defined in [`src/marketplaces.ts`](src/marketplaces.ts). Short codes are the
backend's `com_marketplace.short_code` values; eBay rows use the `EB` prefix
(`EBDE` and `EBAU` appear in VentaWiz's tests).

| Code | Site | Currency | Verified live |
| --- | --- | --- | --- |
| `EBUS` | www.ebay.com | USD | yes |
| `EBUK` | www.ebay.co.uk | GBP | yes (sponsored check) |
| `EBDE` | www.ebay.de | EUR (decimal comma) | yes |
| `EBAU` | www.ebay.com.au | AUD | no — same platform |

**Check these codes against the real `com_marketplace` rows** before go-live;
an unknown code fails with an error naming the known ones.

## Bot check

eBay runs Akamai Bot Manager. A blocked session gets "Pardon Our
Interruption…" / "Security Measure" instead of results. None appeared in
~15 dev-run searches, but the handling mirrors the Walmart scraper: recognised
by title/wording, polled 45 s, reloaded once, then `BlockedError`; +60 s
backoff after a block; the cycle stops after three blocked terms in a row.

## Output markers

`[OK]` / `[FAIL]` per query and a final `[DONE]`, parsed by the agent to
classify the run. `[SPONSORED]` lines are diagnostics only.

## Still to wire up outside this folder

1. **Backend:** VentaWiz has no eBay scraper marketplace —
   `ScraperMarketplace` in `VentaWiz-Backend/src/ventawiz/scrapper/catalog.py`
   needs `EBAY = "ebay"` with prefix `EB`, plus an `ebay-ads` catalog entry
   naming `ebay-search-term-scrapper.exe`. Until then the queue request's
   `marketplace=ebay` is rejected.
2. **Agent:** add an `ebay` kind to `ventahub-agent` (as for Walmart).
3. **CI:** add `ebay-ads-scraper` to `.github/workflows/build-windows-agent.yml`.
