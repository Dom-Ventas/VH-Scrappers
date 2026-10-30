# Walmart Search Term Scrapper — How to run

Same architecture, same payload contract and same commands as the Amazon,
Flipkart and noon scrappers. If you know one, you know this one. The
Walmart-specific differences are called out in the last sections.

## One-time setup (developer)

1. Install **Node.js 20 LTS** from <https://nodejs.org>.
2. Install **Google Chrome** (already installed on most machines). The scraper
   drives the installed Chrome; it does not download Chromium.
3. Open a terminal in this folder and run:
   ```
   npm install
   cp .env.example .env
   ```
4. Edit `.env` and set `VH_API_ROOT` (the VentaWiz server root) and the service account: `VW_AUTH_URL`, `VW_CLIENT_ID` (`svc_…`), `VW_CLIENT_SECRET` (`vws_…`).
   The endpoint URLs default to `${VH_API_ROOT}/v1/scrapper/search-term-queries`
   and `…/search-term-results`; `QUERIES_API_URL` / `RESULTS_API_URL` override
   them.

## Testing end to end (one command)

```
npm run dev-api
```

Boots the mock backend, runs a full scrape of live walmart.com against it,
prints a per-term summary, then shuts down. This is the quickest way to confirm
the scraper still works after a change.

It stays out of your way: the Chrome profile goes to `.dev-profile/`, not your
real `%LOCALAPPDATA%` one, so your saved Walmart location and onboarding state
are untouched. `user-settings.json` is seeded there so the run never stops at
the first-launch form, and the API URLs/token are passed as env vars that
override `.env` for that run only.

Change which terms get scraped by editing `mock/queries.json`.

## Running the mock backend on its own

```
npm run mock     # terminal 1 — http://127.0.0.1:8789
npm run dev      # terminal 2
```

For this, point `.env` at the mock:

```
QUERIES_API_URL=http://127.0.0.1:8789/v1/scrapper/search-term-queries
RESULTS_API_URL=http://127.0.0.1:8789/v1/scrapper/search-term-results
VW_AUTH_URL=http://127.0.0.1:8789
VW_CLIENT_ID=svc_dev
VW_CLIENT_SECRET=vws_dev
```

| Route | Purpose |
| --- | --- |
| `GET  /v1/scrapper/search-term-queries?store_id=13&marketplace=walmart&page=1&limit=100` | Serves the seed list from `mock/queries.json` |
| `POST /v1/scrapper/search-term-results` | Validates + stores a scraped result (201 / 409 / 422) |
| `GET  /v1/scrapper/search-term-results` | Everything received this session |
| `GET  /health` | Liveness |

The port is 8789 (Flipkart's mock uses 8787 and Otto's 8788, so all can run at
once); override with `MOCK_PORT`. The mock also serves `POST /v1/token`, handing out a token for any `svc_…`/`vws_…` pair, and refuses scrapper requests that carry no bearer token (401).

`mock/queries.json` is re-read per request, so no restart is needed after an
edit. Accepted results are written to `mock/received/<store_id>_<term>.json`.
A term already stored this session gets a 409, exactly like VentaWiz.

The POST handler **validates the result contract** and returns 422 with a list
of violations if the payload drifts — missing keys, unexpected keys, wrong
types, or more than 60 products — so a schema regression fails loudly here
instead of silently reaching production.

## Running in dev mode

```
npm run dev
```

- On the very first run, a Chrome window opens showing the Email ID / Store
  IDs form (store ids are positive integers). Fill it in and click **Save and continue**.
- Chrome then navigates to walmart.com. Set your delivery ZIP / store in the
  header ("Pickup or delivery?"), sign in if you like (searching needs no
  account), and complete a "Robot or human?" check if one appears.
- Close the Walmart tab when done — the scraper will continue automatically.
- Subsequent runs skip onboarding entirely and go straight to scraping.

Override the 30-second inter-query delay while developing:
```
SCRAPE_DELAY_MS=2000 npm run dev
```
(On Windows cmd: `set SCRAPE_DELAY_MS=2000 && npm run dev`.)

## Running the tests

```
npm run test:unit   # no browser: parsers, result mapping, sponsored retry
npm test            # everything, incl. two live walmart.com searches
```

The live tests use the same persistent profile as the scraper. To keep them off
your real profile, point them at the dev one:
```
SCRAPER_PROFILE_DIR="$PWD/.dev-profile" npm test
```

## Building the single-file .exe

```
npm run build:exe
```

Output: `dist/walmart-search-term-scrapper.exe` — the name the backend's
`walmart-ads` catalog entry expects.

Double-click it to run. It uses the persistent profile at
`%LOCALAPPDATA%\WalmartSearchTermScrapper\chrome-profile`.

**Requirement on end-user machines:** Google Chrome must be installed.
The exe uses the system Chrome (not a bundled Chromium) so it stays small.

No exe carries a secret. Put `VW_CLIENT_ID` and `VW_CLIENT_SECRET` in a `.env`
beside it, or let the VentaWiz agent pass them. CI bakes in only the VentaWiz
host (`VH_API_ROOT`) and the auth service root (`VW_AUTH_URL`).

## Resetting the first-run state

Delete `%LOCALAPPDATA%\WalmartSearchTermScrapper\chrome-profile` (or just the
`user-settings.json` file inside it) and the next run will show the
onboarding form again.

---

## Payload contract (VentaWiz)

One `POST /v1/scrapper/search-term-results` per search term:

```json
{ "store_id": 13, "search_term": "bluetooth headphones",
  "products": [ { "position": 1, "mp_product_id": "9744661583", "is_sponsored": true,
                  "price": "USD 363.00", "rating": 4.6, "review_count": 4502,
                  "delivery_days": 1, "title": "..." } ] }
```

- `search_term` is sent exactly as the queue handed it out.
- Walmart's **wpid** goes out as `mp_product_id` — the id VentaWiz keys
  Walmart listings by — with the numeric item id as an extra `item_id` field.
- Up to 5 sponsored + 5 organic, in page order; cards without an id are dropped.
- Missing values are `null`, never 0 / -1. An empty `products` is still posted.
- A 409 means the term was already scraped today for that store and is logged
  as `[OK] … (already stored today)`.

## Short codes

Short codes come from the backend's marketplace table — they are not ours to
invent. VentaWiz recognises a Walmart store by the `WM` prefix and hands every
such store to this scraper; `src/marketplaces.ts` must know the code or the
term fails with an error naming the known codes. Today that is `WMUS` only.
The optional `SCRAPE_SHORT_CODES` filter is matched against the same strings;
if it and the DB disagree the scrapper logs a `SHORT CODE MISMATCH` error.

## Which product id

A tile has two ids. `data-item-id` (`79GOUUAPX3NP`) is the **wpid**, Walmart's
product id — the one the Walmart Marketplace API returns for a listing and the
one VentaWiz stores as `mp_product_id` for every Walmart listing. It goes out
as `mp_product_id`. `data-dca-id` (`9744661583`) is the numeric **item id** —
the one in the canonical URL `/ip/<slug>/<id>` and the link's
`link-identifier`; it rides along as `item_id`. Both `walmart.com/ip/<wpid>`
and `walmart.com/ip/<item id>` open the product page.

## Sponsored detection

Walmart labels a paid grid tile with a real "Sponsored" text node (so, unlike
noon and Flipkart, a text match works), wraps it in a
`gpt-sponsored-tag-container`, and routes the tile's link through the
`/sp/track?` ad-click redirect. Any one signal marks the tile.

Audit it any time:

```
npx tsx scripts/check-sponsored.ts "bluetooth headphones"
```

The "Sponsored by \<brand\>" banner above the grid (`plmt=sb-search-top`) is a
Sponsored Brands placement and is excluded by scoping to the grid.

Two silent failure modes it is built to catch: **zero detected** (the markup
moved — confirm visually), and **every card detected** (a signal went broad —
`scrapeSearchTerm()` logs a `SUSPECT:` warning and `npm test` asserts both
bounds).

## Delivery: which badge counts

Each tile lists several badges. Only delivery/shipping lines count, pickup is
ignored, and the earliest wins — so a tile offering express delivery in 13
minutes and ground shipping tomorrow is a `0`. A delivery line with no date
(`Free shipping`) is kept as `deliveryText` with `deliveryDays = null`, so an
audit can tell "no promise" from "unparsed". Measured on `bluetooth
headphones`: 17/20 tiles carried a dated promise; the rest showed no
delivery line at all.

The promise depends on the session's ZIP / store. Set it once on the first
run; Walmart remembers it in the Chrome profile.

## When Walmart changes its DOM

All selectors live in one place: `src/extractors.ts` (`SELECTORS`). Walmart
ships stable hooks (`data-testid`, `data-automation-id`, `data-test-id`,
`data-dca-id`) and a screen-reader text line per field; every field reads a
hook first and the tile's text last. Never select on class names — `ld_Ec`,
`wcp-rating_star__mfA6I` and the Tachyons utilities are build output.

To re-derive selectors, run with `BROWSER_VISIBLE=1` and inspect a search
results page, or get a per-field fill rate directly:

```
npx tsx scripts/inspect-result.ts "bluetooth headphones"
```

If `title` and `price` are full and only `rating` is empty, the data isn't on
the page — a brand-new listing has no reviews yet.

## Bot check

Walmart serves a "Robot or human?" press-and-hold page (PerimeterX) to
sessions it distrusts — intermittently, per session: in a five-term dev run one
term got it and the others did not. The scraper recognises the page by its
title and wording (not by the hidden `#px-captcha` element, which is on normal
pages too), polls up to 45 s for it to clear (it usually does), reloads once,
and only then fails the term with a `BlockedError` that says so instead of
"no results". After a blocked term it backs off an extra 60 s; after three
blocked terms in a row it ends the cycle and leaves the remaining terms for
the next one — they stay due in the queue because nothing was stored.

If a laptop is blocked repeatedly: run once with `BROWSER_VISIBLE=1`, complete
the check in the scraper's Chrome window, and raise `SCRAPE_DELAY_MS`. The
profile keeps the cleared state.
