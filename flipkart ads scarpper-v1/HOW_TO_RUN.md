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
4. Edit `.env` and fill in `QUERIES_API_URL`, `RESULTS_API_URL`, `API_TOKEN`.
   They ship blank — with `QUERIES_API_URL` blank the scrapper runs against two
   built-in sample queries, and with `RESULTS_API_URL` blank the POST step
   throws.

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
request, so no restart needed. It seeds a single profile, `PRF-001`, holding
every keyword. Accepted results are written to
`mock/received/<profileId>_<queryId>.json`.

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
