# xlsx-keyword-scraper

Scrape Amazon search results for keywords you keep in an **Excel file**, and get
the results back as an **Excel file**.

This is a standalone tool. It does **not** talk to VentaHub — it neither fetches
keywords from the VH API nor posts results back. The automated
`amazon-ads-scraper` (VH in → VH out) is untouched and keeps working exactly as
before; use this one for ad-hoc keyword lists of your own.

It also uses its **own Chrome profile** (`./chrome-profile`), deliberately
separate from the VH agent's, so signing in here never disturbs the automated
agent's session.

---

## Quick start

```bash
npm install
npm run sample     # writes a starter keywords.xlsx you can edit
npm run dev
```

On the **first run** a Chrome window opens on Amazon. Sign in, set your delivery
pincode, then **close that tab** — scraping starts automatically. Later runs skip
this and run off-screen so you can keep using your machine.

When it finishes you get `results-<timestamp>.xlsx` next to your input file.

> **Sign in and set a pincode.** Signed out, Amazon hides prices and delivery
> estimates, and those columns come back empty. Everything else (ASIN, title,
> rating, reviews, sponsored/organic) still works.

---

## The input file

Default: `keywords.xlsx` in this folder. Override it with a path argument —

```bash
npm run dev -- "C:\Users\me\Desktop\my keywords.xlsx"
```

— or with `INPUT_FILE` in `.env`. The first worksheet is read.

**With a header row** (any of `Keyword`, `Keywords`, `Search Term`, `Query`,
`Term`), the columns are found by name and can sit anywhere. An optional
marketplace column (`Marketplace`, `Short Code`, `Country`, `Site`, ...) sets the
Amazon domain per keyword:

| Keyword              | Marketplace |
| -------------------- | ----------- |
| bluetooth headphones | AZIN        |
| running shoes        | AZUS        |
| yoga mat             |             |

**Without a header row**, the sheet is treated as a bare list and column A is
taken as the keyword. Either way:

- junk/title rows above the real header are skipped (the first 10 rows are scanned)
- blank rows are skipped
- duplicates are dropped, keeping the first (case-insensitive, per marketplace)
- a blank or missing marketplace falls back to `DEFAULT_SHORT_CODE` (default `AZIN`)
- an unrecognised marketplace code skips that row with a warning

Valid codes are in [`src/marketplaces.ts`](src/marketplaces.ts): `AZIN` `AZUS`
`AZUK` `AZAU` `AZCA` `AZDE` `AZFR` `AZIT` `AZES` `AZNL` `AZBE` `AZMX` `AZPO`
`AZSW` `AZAE` `AZSA`.

## The output file

Two sheets:

**Products** — one row per product: Input Row, Keyword, Marketplace, Domain,
Type (Sponsored/Organic), Ad Format, Position, ASIN, Title, Price, Rating,
Reviews, Delivery Days, Delivery Text, Scraped At.

`Position` is the product's place in **true page reading order** (top to bottom,
left to right across the grid), so "first 5 sponsored" means first on the page.

`Ad Format` distinguishes the two Amazon ad placements:

- **Sponsored Brands** — the brand banner *above* the grid, holding 3-4 products.
  These are the page's first sponsored placements. Amazon does not render a
  review count or delivery estimate in these tiles, so those two columns are
  blank for them; ASIN, title, price and rating are captured.
- **Sponsored Products** — a normal grid card carrying a "Sponsored" badge.
  Full data.
- *(blank)* — organic.

Set `INCLUDE_SPONSORED_BRANDS=0` to count only Sponsored Products grid cards
(this matches what the VentaHub `amazon-ads-scraper` reports).

**Summary** — one row per keyword: how many sponsored and organic came back,
`OK`/`FAILED`, and the error if it failed.

By default each keyword contributes up to 5 sponsored + 5 organic rows
(`MAX_SPONSORED` / `MAX_ORGANIC`; set either to `0` for no cap).

**The workbook is saved after every keyword**, not just at the end — so at any
point during a long run, the file on disk already holds everything scraped so
far. You can open it mid-run to check progress.

Press **Ctrl+C** to stop early: it interrupts the wait immediately, finishes
saving, and exits cleanly. Nothing already scraped is lost. (Press it a second
time to force-quit instead.) Saves are atomic — a write interrupted halfway
can't leave you with a corrupt workbook.

---

## Settings

All optional — copy `.env.example` to `.env` and edit. Defaults work as-is.

| Variable | Default | What it does |
| --- | --- | --- |
| `INPUT_FILE` | `./keywords.xlsx` | Keywords workbook (a CLI argument wins over this) |
| `OUTPUT_FILE` | `results-<timestamp>.xlsx` | Where results go |
| `DEFAULT_SHORT_CODE` | `AZIN` | Marketplace for rows without one |
| `SCRAPE_DELAY_MS` | `30000` | Pause between keywords — don't lower it much for long lists |
| `BROWSER_VISIBLE` | off | `1` to watch Chrome work |
| `TOP_N_RESULTS` | `20` | Result cards read per search page |
| `MAX_SPONSORED` / `MAX_ORGANIC` | `5` / `5` | Per-keyword caps in the output; `0` = no cap |
| `INCLUDE_SPONSORED_BRANDS` | on | `0` to ignore Sponsored Brands banners and count only grid cards |
| `SCRAPER_PROFILE_DIR` | `./chrome-profile` | Chrome profile location |

While testing a few keywords, skip the 30s wait:

```bash
SCRAPE_DELAY_MS=2000 npm run dev
```

## Building a Windows .exe

```bash
npm run build:exe
```

Produces `dist/xlsx-keyword-scraper.exe`. Drop it in a folder with your
`keywords.xlsx` and double-click, or drag an .xlsx onto it. Google Chrome must be
installed on that machine — the exe uses the system Chrome rather than bundling
one.

## The portable folder

```bash
npm run portable
```

Refreshes `portable/` — the .exe, a starter `keywords.xlsx`, a commented `.env`,
`run.bat` (keeps the console window open so errors are readable) and its own
[README](portable/README.md) written for someone who has never seen this repo.
Zip that folder and it runs on any 64-bit Windows 10/11 machine with Google
Chrome installed; nothing else to install.

Never ship `portable/chrome-profile/` — it holds a machine's Amazon session. It
is created fresh on the target machine's first run, and git ignores it.

## Troubleshooting

**"No search results loaded ... (possible CAPTCHA or block page)"** — Amazon
served a bot check. Run with `BROWSER_VISIBLE=1`, solve it once in the window,
and the profile keeps that state. Raising `SCRAPE_DELAY_MS` makes it rarer.

**Reviews / Delivery blank on some sponsored rows** — check the Ad Format
column. Sponsored Brands banner tiles don't render those fields at all, so
they're blank by design, not a scrape failure.

**Price / Delivery columns empty** — you're signed out or have no delivery
pincode set. Delete `chrome-profile/` and run again to redo the sign-in step.

**"Input file not found"** — the path is wrong, or `keywords.xlsx` isn't next to
the app. Run `npm run sample` to generate one.
