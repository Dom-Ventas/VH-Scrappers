# eBay Search Term Scrapper — How to run

Same architecture, same payload contract and same commands as the Amazon,
Flipkart, noon and Walmart scrappers. If you know one, you know this one. The
eBay-specific differences are called out in the last sections.

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

Boots the mock backend, runs a full scrape of live eBay against it,
prints a per-term summary, then shuts down. This is the quickest way to confirm
the scraper still works after a change.

It stays out of your way: the Chrome profile goes to `.dev-profile/`, not your
real `%LOCALAPPDATA%` one, so your saved eBay location and onboarding state
are untouched. The first `dev-api` run on a new machine needs "Shipping to"
set in that profile too — see [Shipping location](#shipping-location). `user-settings.json` is seeded there so the run never stops at
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
| `GET  /v1/scrapper/search-term-queries?store_id=13&marketplace=ebay&page=1&limit=100` | Serves the seed list from `mock/queries.json` |
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
- Chrome then navigates to an ebay.com search. Click **Shipping to** in the
  left column and set the marketplace's country and postcode (e.g. USA,
  10001). Repeat on each eBay site the stores sell on (ebay.de, …). Sign-in
  is optional.
- Close the eBay tab when done — the scraper will continue automatically.
- Subsequent runs skip onboarding entirely and go straight to scraping.

Override the 30-second inter-query delay while developing:
```
SCRAPE_DELAY_MS=2000 npm run dev
```
(On Windows cmd: `set SCRAPE_DELAY_MS=2000 && npm run dev`.)

## Running the tests

```
npm run test:unit   # no network: parsers, result mapping, sponsored probe on captured markup
npm test            # everything, incl. two live ebay.com searches
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

Output: `dist/ebay-search-term-scrapper.exe` — the name the backend's
`ebay-ads` catalog entry should name once it exists.

Double-click it to run. It uses the persistent profile at
`%LOCALAPPDATA%\EbaySearchTermScrapper\chrome-profile`.

**Requirement on end-user machines:** Google Chrome must be installed.
The exe uses the system Chrome (not a bundled Chromium) so it stays small.

No exe carries a secret. Put `VW_CLIENT_ID` and `VW_CLIENT_SECRET` in a `.env`
beside it, or let the VentaWiz agent pass them. CI bakes in only the VentaWiz
host (`VH_API_ROOT`) and the auth service root (`VW_AUTH_URL`).

## Resetting the first-run state

Delete `%LOCALAPPDATA%\EbaySearchTermScrapper\chrome-profile` (or just the
`user-settings.json` file inside it) and the next run will show the
onboarding form again.

---

## Payload contract (VentaWiz)

One `POST /v1/scrapper/search-term-results` per search term:

```json
{ "store_id": 13, "search_term": "bluetooth headphones",
  "products": [ { "position": 1, "mp_product_id": "405424132378", "is_sponsored": true,
                  "price": "USD 14.99", "rating": null, "review_count": null,
                  "delivery_days": null, "title": "..." } ] }
```

- `search_term` is sent exactly as the queue handed it out.
- eBay's **item number** (`data-listingid`, the id in `/itm/<id>`) goes out as
  `mp_product_id` — the id VentaWiz keys eBay listings by.
- Up to 5 sponsored + 5 organic, in page order; cards without an id are dropped.
- Missing values are `null`, never 0 / -1. An empty `products` is still posted.
- A 409 means the term was already scraped today for that store and is logged
  as `[OK] … (already stored today)`.

## Short codes

Short codes come from the backend's marketplace table — they are not ours to
invent. eBay rows use the `EB` prefix; `src/marketplaces.ts` knows `EBUS`,
`EBUK`, `EBDE` and `EBAU`, and a term with any other code fails with an error
naming the known ones. **Confirm these against the real `com_marketplace`
rows** — only `EBDE` and `EBAU` were seen (in VentaWiz's tests). The optional
`SCRAPE_SHORT_CODES` filter is matched against the same strings; if it and the
DB disagree the scrapper logs a `SHORT CODE MISMATCH` error.

## Shipping location

eBay decides which listings appear from the session's **"Shipping to"**
location and defaults it to the machine's IP country. Left on India,
ebay.com returned "0 results" for `vintage pyrex bowl` (36,000+ once set to
USA 10001) and showed international delivery costs on everything else. The
choice is stored **per eBay site** in the Chrome profile, so set it on every
site the laptop's stores sell on. To do it after first run:

```
BROWSER_VISIBLE=1 npm run dev
```

…then, in the scraper's window, open the site, search anything, click
**Shipping to** in the left column, pick the country, enter a postcode and
apply. The profile keeps it.

## Sponsored detection

eBay plants a "Sponsored" label on **every** card and hides it on organic
ones by drawing the SVG text off-canvas; the aria label and a reversed decoy
span are noise. The scraper rasterises each card's label SVG onto a canvas
and counts painted pixels — what a human would see — with an offset
calculation as fallback. Details in the README.

Audit it any time:

```
npx tsx scripts/check-sponsored.ts "bluetooth headphones"
npx tsx scripts/check-sponsored.ts "bluetooth kopfhörer" --short-code=EBDE
```

`detected` and `offsets` must agree; `aria` disagreeing is expected.

Two silent failure modes it is built to catch: **zero detected** (the label
moved — confirm visually), and **every card detected** (eBay changed how it
hides the decoy — `scrapeSearchTerm()` logs a `SUSPECT:` warning and
`npm test` asserts both bounds).

## Delivery

eBay's card shows delivery as one attribute row. Often it is only a cost
(`Free delivery`, `+$20.00 delivery`, `+EUR 26,37 Lieferung`) — kept as
`deliveryText` with `deliveryDays = null`. When it carries a promise
(`Free delivery in 2-3 days`, `Get it by Fri, Oct 16`, `Lieferung bis Do,
16. Okt`) the earliest day wins. Measured on `bluetooth headphones`
(ship-to USA): 5/20 cards dated. Shipped abroad, none are.

## When eBay changes its DOM

All selectors live in `src/extractors.ts` (`SELECTORS`). eBay's 2025+ search
page uses stable `s-card__*` classes and screen-reader `.clipped` spans. Get a
per-field fill rate with:

```
npx tsx scripts/inspect-result.ts "bluetooth headphones"
npx tsx scripts/inspect-result.ts "bluetooth kopfhörer" EBDE
```

`rating` / `review_count` are legitimately sparse — eBay only shows them on
listings tied to a catalogue product page.

## Bot check

eBay runs Akamai Bot Manager ("Pardon Our Interruption…"). None appeared
during development. If one does, the scraper polls 45 s, reloads once, then
fails the term with a `BlockedError`; it backs off an extra 60 s after a
block and ends the cycle after three in a row (those terms stay due). If a
laptop is blocked repeatedly: run once with `BROWSER_VISIBLE=1`, clear the
check in the scraper's window, and raise `SCRAPE_DELAY_MS`.
