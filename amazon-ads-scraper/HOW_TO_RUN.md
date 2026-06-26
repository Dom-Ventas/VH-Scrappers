# Search Term Scrapper — How to run

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
5. Open `src/api/queries.ts` and `src/api/results.ts` and replace the TODO
   placeholders with your real API calls.

## Running in dev mode

```
npm run dev
```

- On the very first run, a Chrome window opens showing the Email ID / Profile
  ID form. Fill it in and click **Save and continue**.
- Chrome then navigates to Amazon. Sign in once and set your delivery pincode.
- Close the Amazon tab when done — the scraper will continue automatically.
- Subsequent runs skip onboarding entirely and go straight to scraping.

Override the 30-second inter-query delay while developing:
```
set SCRAPE_DELAY_MS=2000 && npm run dev
```

## Running the Playwright tests

```
npm test
```

These hit live Amazon and assert the scraper returns 5 valid products per
query. Uses the same persistent profile so login state is reused.

## Building the single-file .exe

```
npm run build:exe
```

Output: `dist/search-term-scrapper.exe`

Double-click it to run. It uses the same persistent profile at
`%LOCALAPPDATA%\SearchTermScrapper\chrome-profile`, so once you've completed
the first-run setup with `npm run dev`, the .exe reuses it.

**Requirement on end-user machines:** Google Chrome must be installed.
The exe uses the system Chrome (not a bundled Chromium) so it stays small.

## Resetting the first-run state

Delete `%LOCALAPPDATA%\SearchTermScrapper\chrome-profile` (or just the
`user-settings.json` file inside it) and the next run will show the
onboarding form again.
