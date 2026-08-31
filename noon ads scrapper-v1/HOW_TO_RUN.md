# Noon Search Term Scrapper — How to run

Same architecture, same payload contract and same commands as the Flipkart and
Amazon scrappers. If you know one, you know this one. The noon-specific
differences are called out in the last three sections.

## One-time setup (developer)

1. Install **Node.js 20 LTS** from <https://nodejs.org> (pick the Windows x64 installer).
2. Install **Google Chrome** (already installed on most machines).
3. Open a terminal in this folder and run:
   ```
   npm install
   npx playwright install-deps
   cp .env.example .env
   ```
4. Edit `.env` and fill in `QUERIES_API_URL`, `RESULTS_API_URL`, `API_TOKEN`.
   They ship blank in `.env.example` — with `QUERIES_API_URL` blank the scrapper
   runs against two built-in sample queries, and with `RESULTS_API_URL` blank the
   POST step throws.

## Testing end to end (one command)

```
npm run dev-api
```

Boots the mock backend, runs a full scrape against it, prints a per-keyword
summary, then shuts down. This is the quickest way to confirm the scraper still
works after a change.

It stays out of your way: the Chrome profile goes to `.dev-profile/`, not your
real `%LOCALAPPDATA%` one, so your saved noon login and onboarding state are
untouched. `user-settings.json` is seeded there so the run never stops at the
first-launch form, and the API URLs/token are passed as env vars that override
`.env` for that run only.

Change which keywords get scraped by editing `mock/queries.json`.

## Running the mock backend on its own

```
npm run mock     # terminal 1 — http://127.0.0.1:8787
npm run dev      # terminal 2
```

Use this when you want the scraper to behave exactly as in production
(real profile dir, `.env` config) with only the API faked.

| Route | Purpose |
| --- | --- |
| `GET  /backend/api/v1/scrapper/queries?profile_id=PRF-001` | Serves the seed list from `mock/queries.json` |
| `POST /backend/api/v1/scrapper/results` | Validates + stores a scraped result |
| `GET  /backend/api/v1/scrapper/results` | Everything received this session |
| `GET  /health` | Liveness |

Bearer token is `dummy-local-token` (override with `MOCK_API_TOKEN`); requests
without it get a 401.

Edit `mock/queries.json` to change which keywords get scraped — it's re-read per
request, so no restart needed. It seeds a single profile holding every keyword.
Accepted results are written to `mock/received/<profileId>_<queryId>.json`.

The POST handler **validates the ScrapedResult contract** and returns 400 with a
list of violations if the payload drifts — missing keys, unexpected keys, wrong
types, or more than 10 products. That way a schema regression fails loudly here
instead of silently reaching production.

Pointing at the real backend is a host swap in `.env`; the paths already match
production.

## Running in dev mode

```
npm run dev
```

- On the very first run, a Chrome window opens showing the Email ID / Profile
  ID form. Fill it in and click **Save and continue**.
- Chrome then navigates to noon. Sign in once and set your delivery address.
  **Do not skip the address** — noon only renders a dated delivery estimate
  ("Get it by 27 Aug") once an address is resolved for the session. Without one
  you get express or a bare "Free Delivery" badge, and `deliveryDays` comes back
  null more often. See the delivery section below.
- Close the noon tab when done — the scraper will continue automatically.
- Subsequent runs skip onboarding entirely and go straight to scraping.

Override the 30-second inter-query delay while developing:
```
set SCRAPE_DELAY_MS=2000 && npm run dev
```

## Running the Playwright tests

```
npm test
```

These hit live noon and assert the scraper returns valid products per query.
Uses the same persistent profile so login state is reused. Point them at another
storefront with `TEST_SHORT_CODE=NNSA npm test`.

## Building the single-file .exe

```
npm run build:exe
```

Output: `dist/noon-search-term-scrapper.exe`

Double-click it to run. It uses the same persistent profile at
`%LOCALAPPDATA%\NoonSearchTermScrapper\chrome-profile`, so once you've completed
the first-run setup with `npm run dev`, the .exe reuses it.

**Requirement on end-user machines:** Google Chrome must be installed.
The exe uses the system Chrome (not a bundled Chromium) so it stays small.

## Resetting the first-run state

Delete `%LOCALAPPDATA%\NoonSearchTermScrapper\chrome-profile` (or just the
`user-settings.json` file inside it) and the next run will show the
onboarding form again.

---

## Payload contract: one deliberate difference from the sibling scrappers

The `ScrapedResult` posted to the backend is identical to the Amazon and
Flipkart scrappers' — same top-level keys, same nine per-product keys, same
types — **except for the product identifier**:

| Scrapper | Key | Value it carries |
| --- | --- | --- |
| Amazon | `asin` | ASIN |
| Flipkart | `asin` | Flipkart PID |
| **noon** | **`sku`** | **noon SKU** (`N70034197V`, `Z38F7F87F384F17FD4824Z`) |

"ASIN" is an Amazon term that means nothing on noon, so this scrapper names the
field for what it actually holds. **The backend needs a noon-specific mapping
for this key** — or the other two scrappers need the same rename — otherwise the
identifier column lands NULL on every noon row.

`mock/server.ts` enforces this: it 400s on a payload containing `asin`, so a
drift back to the old key fails loudly in dev instead of silently reaching
production.

## Storefronts: the short code picks the country

Unlike Flipkart (one host, one storefront), **noon serves every country from the
same host** and scopes the storefront in the first path segment:
`noon.com/uae-en/search/?q=...`. Get it wrong and you silently scrape another
country's catalogue and currency, so it is resolved from the backend's
`short_code`, never guessed. The table lives in `src/marketplaces.ts`:

| Short code | Storefront | Currency |
| --- | --- | --- |
| `NNAE` | `uae-en` | AED |
| `NNSA` | `saudi-en` | SAR |

**Short codes come from the backend's marketplace table — they are not ours to
invent.** The launcher passes the same strings through as a `SCRAPE_SHORT_CODES`
filter, so if this table and the DB disagree the run fails *silently and
totally*: the filter matches nothing, every query is dropped, and the scrapper
reports success having scraped zero keywords. Noon runs an Egypt storefront on
the web, but there is no marketplace row for it, so there is no code for it
here — add one only when the DB does.

`price` carries the currency code (`"AED 165.30"`) because noon draws the
currency as an icon-font glyph with **no text content**, so scraping the card
alone yields a unit-less `165.30`. The marketplace table is the only place the
unit is recoverable.

## Sponsored detection: the "Ad" badge is an SVG, not text

Noon marks a paid placement with a small grey **"Ad"** pill at the bottom-left of
the product image. That pill is an inline `<svg>` of vector paths with **no text
node in it**:

```html
<div class="_overlayFooter_1m97z_45">
  <div class="_container_1xibb_1">
    <svg width="20" height="16" viewBox="0 0 21 16">
      <rect ... fill="white" fill-opacity="0.7"/>
      <path d="M10.488 12H9.34795..." fill="#9BA0B1"/>   <!-- draws "A" + "d" -->
```

So `innerText` scans, a raw-HTML search for `"sponsor"`, and
`:text-is("Ad")` **all return zero on a page that is 45% ads**. This is the same
trap Flipkart sets with its "Sponsored" SVG. Never trust a text-based check for
ads on either site — match on structure and geometry instead.

Detection is therefore keyed on `svg[viewBox="0 0 21 16"]` inside the image
overlay footer, with two independent backstops. Measured on `uae-en`: a
consistent **9 of the top 20** flagged on "shampoo", "perfume", "protein
powder", "laptop" and "diapers", with all signals agreeing card-for-card.

Audit it any time:

```
npx tsx scripts/check-sponsored.ts "shampoo"
```

Two failure modes it is built to catch, because they fail *silently*:

- **Zero detected** — the badge markup changed. Nothing throws; the ads column
  just goes empty. Confirm visually that no card shows the grey "Ad" pill.
- **Every card detected** — a selector went broad. The `structural` signal
  (`_overlayFooter_ svg`) is safe only because the footer's other controls are
  `<img>`, not `<svg>`; if noon adds an inline-SVG icon there it will match
  everything. `scrapeSearchTerm()` logs a loud `SUSPECT:` warning in that case,
  and `npm test` asserts sponsored is both `> 0` and `< 20`.

## Delivery fields: real data, partial fill

Unlike Flipkart — whose grid carries no delivery promise at all, leaving both
fields permanently null — noon renders the promise on the card, so these carry
real data. Three shapes, and only two of them contain a date:

| Card text | `deliveryDays` |
| --- | --- |
| `GET IN 49 MINS` (noon express) | `0` |
| `Get it by 27 Aug` / `Get it by Tomorrow` | `N` |
| `Free Delivery` | `null` — a shipping-**cost** badge, no date in it |

So a null `deliveryDays` next to a non-null `deliveryText` is expected, not a
parse failure. Measured fill on a 20-card `uae-en` "protein powder" scrape:
20/20 `deliveryText`, 13/20 `deliveryDays`. On `saudi-en` "perfume" it was
20/20 on both.

When a card shows both a cost badge and a dated promise, the dated one wins —
`deliveryLineFrom()` prefers a line that actually parses, so the badge can't
mask the date.

## When noon changes its DOM

All selectors live in one place: `src/extractors.ts` (`SELECTORS`).

Noon is a far friendlier target than Flipkart. The card, title and price are
pinned to stable semantic `data-qa` hooks (`plp-product-box`,
`plp-product-box-name`, `plp-product-box-price`) that survive releases. Rating,
review count and delivery have no `data-qa` and go through hashed CSS-module
class names (`_countCtr_1r83y_47`) that rotate every build — but noon's hash is a
**suffix** of a readable name, so an attribute-contains match on the prefix
(`[class*="_countCtr_"]`) survives a rehash where a full class match would not.
Every field also falls back to parsing the card's own text. Keep both layers.

To re-derive selectors after a break, run with `BROWSER_VISIBLE=1` and inspect a
search results page, or get a per-field fill rate directly:

```
npx tsx scripts/inspect-result.ts "protein powder"
npx tsx scripts/inspect-result.ts "perfume" NNSA
```

If `title` and `price` are full and only `rating` is empty, the data isn't on the
page — some brand-new listings genuinely have no reviews yet (3 of the top 5 on
a `laptop` search, for example).

**Do not** add an href match on `o=` or `nav_ctx=` to the sponsored selectors.
`o=` is a page-level tracking token echoed into every card's href — it matched
78 of 78 cards and would report the whole page as sponsored. `nav_ctx` is the
same trap from the other side: 1 of 78 organic cards. (Flipkart has the identical
trap with `ppt=sp` / `fm=organic`.)
