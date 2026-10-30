# Flipkart Search Term Scrapper — How to run

## One-time setup (developer)

1. Install **Node.js 20 LTS** from <https://nodejs.org> (pick the Windows x64 installer).
2. Install **Google Chrome** (already installed on most machines).
3. Open a terminal in this folder and run:
   ```
   npm install
   npx playwright install-deps
   cp .env.example .env
   ```
4. Edit `.env` and fill in `VH_API_ROOT` (the VentaWiz server root),
   `VW_AUTH_URL` (the VentaWiz auth service root) and the service account
   `VW_CLIENT_ID` (`svc_…`) / `VW_CLIENT_SECRET` (`vws_…`) — ask a VentaWiz
   admin for one with `scrapper:run`. The queue and results URLs default to
   `<VH_API_ROOT>/v1/scrapper/search-term-queries` and
   `.../search-term-results`; set `QUERIES_API_URL` / `RESULTS_API_URL` only to
   override them.

## Testing end to end (one command)

```
npm run dev-api
```

Boots the mock backend, runs a full scrape against it, prints a per-keyword
summary, then shuts down. This is the quickest way to confirm the scraper still
works after a change.

It stays out of your way: the Chrome profile goes to `.dev-profile/`, not your
real `%LOCALAPPDATA%` one, so your saved Flipkart login and onboarding state are
untouched. `user-settings.json` is seeded there so the run never stops at the
first-launch form, and the API URLs, `VW_AUTH_URL` (the mock itself) and a
dummy service account (`svc_dev` / `vws_dev`) are passed as env vars that
override `.env` for that run only.

Change which search terms get scraped by editing `mock/queries.json`.

## Running the mock backend on its own

```
npm run mock     # terminal 1 — http://127.0.0.1:8787
npm run dev      # terminal 2
```

Use this when you want the scraper to behave exactly as in production
(real profile dir, `.env` config) with only the API faked.

| Route | Purpose |
| --- | --- |
| `GET  /v1/scrapper/search-term-queries?store_id=13&marketplace=flipkart` | Serves the paginated seed list from `mock/queries.json` |
| `POST /v1/scrapper/search-term-results` | Validates + stores a scraped result (409 on a repeat) |
| `GET  /v1/scrapper/search-term-results` | Everything received this session |
| `POST /v1/token` | Fake service-account exchange: any `svc_…` / `vws_…` pair gets a token, anything else 401 `invalid_client` |
| `GET  /health` | Liveness |

Any `Authorization: Bearer …` is accepted (tokens are not verified); requests
without one get a 401. For `npm run dev` against the mock, set
`VW_AUTH_URL=http://127.0.0.1:8787` and any `svc_…` / `vws_…` pair in `.env`.

Edit `mock/queries.json` to change which search terms get scraped — it's
re-read per request, so no restart needed. It is a list of queue items
(`{ store_id, short_code, search_term }`) for store `13`. Accepted results are
written to `mock/received/<store_id>_<search_term>.json`, and a term already
stored this session is left out of the queue, as the real backend does for
today.

The POST handler **validates the search-term result contract** and returns 422
with a list of violations if the payload drifts — missing keys, unexpected
keys, wrong types or ranges, or more than 60 products. That way a schema regression fails loudly here
instead of silently reaching production.

Pointing at the real backend is a host swap in `.env`; the paths already match
production.

## Running in dev mode

```
npm run dev
```

- On the very first run, a Chrome window opens showing the Email ID / Store
  IDs form (VentaWiz store ids, whole numbers). Fill it in and click **Save and continue**.
- Chrome then navigates to Flipkart. Sign in once and set your delivery pincode.
  Signing in also stops the login modal from covering the search grid later.
- Close the Flipkart tab when done — the scraper will continue automatically.
- Subsequent runs skip onboarding entirely and go straight to scraping.

Override the 30-second inter-query delay while developing:
```
set SCRAPE_DELAY_MS=2000 && npm run dev
```

## Running the Playwright tests

```
npm test
```

These hit live Flipkart and assert the scraper returns valid products per
query. Uses the same persistent profile so login state is reused.

## Building the single-file .exe

```
npm run build:exe
```

Output: `dist/flipkart-search-term-scrapper.exe`

Double-click it to run. It uses the same persistent profile at
`%LOCALAPPDATA%\FlipkartSearchTermScrapper\chrome-profile`, so once you've
completed the first-run setup with `npm run dev`, the .exe reuses it.

**Requirement on end-user machines:** Google Chrome must be installed.
The exe uses the system Chrome (not a bundled Chromium) so it stays small.

## Resetting the first-run state

Delete `%LOCALAPPDATA%\FlipkartSearchTermScrapper\chrome-profile` (or just the
`user-settings.json` file inside it) and the next run will show the
onboarding form again.

## Expect null ratings in some categories

`rating` / `reviewCount` fill rates vary a lot by keyword, and this is Flipkart,
not the scraper:

| Keyword | Cards with a rating widget |
| --- | --- |
| bluetooth headphones | 18 / 20 |
| running shoes | 0 / 20 |
| smart watches | 0 / 20 |

Flipkart renders a different card layout per category, and the shoes/watches
grids ship no rating widget in the DOM at all — verified by counting the star
`<img>` element, which is absent on every card. So a run of nulls for a keyword
is not a selector regression. Confirm with
`npx tsx scripts/inspect-result.ts "<keyword>"`, which prints a per-field fill
rate; if `title` and `price` are full and only `rating` is empty, the data isn't
on the page.

## Known gap: delivery fields are always null

`deliveryText` / `deliveryDays` are in the payload for contract parity with the
Amazon scrapper, but Flipkart's search grid renders no delivery promise on the
card — verified across headphones / laptop / refrigerator / shoes searches. That
promise lives only on the product detail page, behind a resolved pincode.

Populating them for real requires visiting each product's PDP, which is 20x the
requests per query. Flag this before wiring the backend if those columns are
load-bearing.

## When Flipkart changes its DOM

Flipkart ships build-hashed class names (`.Nx9bqj`, `._30jeq3`, ...) that rotate
every few releases, and serves three different search layouts. All selectors
live in one place: `src/extractors.ts` (`SELECTORS`). Each field lists several
historical class names and falls back to parsing the card's own text, so a
class-name rotation degrades gracefully instead of returning nulls. To re-derive
selectors, run with `BROWSER_VISIBLE=1` and inspect a search results page.
