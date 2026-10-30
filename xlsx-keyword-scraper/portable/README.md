# Amazon Keyword Scraper — portable

Put your keywords in an Excel file, get the Amazon search results back as an
Excel file. Nothing to install: this folder is self-contained, copy it onto any
Windows PC and run it.

```
portable\
  run.bat                    >>> double-click this. It is the only thing you run.
  xlsx-keyword-scraper.exe   the whole app (Node + the scraper are inside)
  keywords.xlsx              your keywords go here
  .env                       settings (optional — defaults are fine)
  README.md                  this file
  REQUIREMENTS.md            what the PC needs, in full
```

`run.bat` checks the PC before it starts — 64-bit Windows, Chrome installed, the
keywords file present, the folder writable — and tells you in plain words what
to fix if something is missing. It then runs the scraper and holds the window
open at the end with the name of the results file. You never need to touch the
.exe directly.

---

## Requirements

Short version — `run.bat` verifies all of these for you:

| Needed | Why |
| --- | --- |
| **Windows 10 or 11, 64-bit** | the .exe is built for `node20-win-x64` |
| **Google Chrome** installed | the app drives your real Chrome; it does not bundle a browser. Free from <https://www.google.com/chrome/> |
| **An internet connection** | it loads amazon.in / amazon.com / … live |
| **~400 MB free disk space** | 65 MB for the .exe plus the Chrome profile it creates on first run |
| **A writable folder** (Desktop, Documents — not `C:\Program Files`) | results are saved next to the .exe |
| An Amazon account (recommended) | signed out, Amazon hides prices and delivery dates and those columns come back empty |

Not needed: Node.js, npm, Python, admin rights, or any install step. Copying the
folder is the install.

Full detail, including timings for long keyword lists and the antivirus and
SmartScreen caveats, is in **[REQUIREMENTS.md](REQUIREMENTS.md)**.

**First launch may be slow (10–30 s)** — the .exe unpacks itself into a temp
folder. Later launches are quick.

**Windows SmartScreen** may warn that the app is unrecognised (the .exe is
unsigned). Click **More info → Run anyway**.

---

## Running it

1. Copy this whole folder to the PC — Desktop, a USB stick, anywhere you can
   write files. Don't run it from inside a .zip; extract it first.
2. Open `keywords.xlsx` and put your keywords in (see the layout below). Save
   and close Excel — **the file must be closed** or Excel locks it.
3. Double-click **`run.bat`**. It prints a short checklist, then starts.

On the **very first run** a Chrome window opens on Amazon. Sign in, set your
delivery pincode, then **close that tab** — scraping starts by itself. Every
later run reuses that session and runs off-screen, so you can keep working
while it goes.

When it finishes you get **`results-<date>_<time>.xlsx`** in this folder.

You can also drag any .xlsx straight onto **`run.bat`** to scrape that file
instead of `keywords.xlsx`.

**To stop early:** press **Ctrl+C** in the black window. It stops waiting,
saves, and exits cleanly — nothing already scraped is lost. (The results file is
in fact saved after *every* keyword, so it is always up to date on disk; you can
even open it mid-run to watch progress.)

---

## The keywords file

The first worksheet is read. A header row (`Keyword`, `Keywords`, `Search Term`,
`Query` or `Term`) lets the columns sit anywhere. An optional marketplace column
(`Marketplace`, `Short Code`, `Country`, `Site`) picks the Amazon site per row:

| Keyword              | Marketplace |
| -------------------- | ----------- |
| bluetooth headphones | AZIN        |
| running shoes        | AZUS        |
| yoga mat             |             |

With no header row at all, column A is taken as the keyword list.

- blank rows, and junk rows above the real header, are skipped
- duplicates are dropped (case-insensitive, per marketplace)
- a blank marketplace falls back to `DEFAULT_SHORT_CODE` in `.env` (`AZIN`)
- an unknown marketplace code skips that row with a warning

Marketplace codes: `AZIN` (India) `AZUS` `AZUK` `AZAU` `AZCA` `AZDE` `AZFR`
`AZIT` `AZES` `AZNL` `AZBE` `AZMX` `AZPO` `AZSW` `AZAE` `AZSA`.

## The results file

**Products** — one row per product: Input Row, Keyword, Marketplace, Domain,
Type (Sponsored/Organic), Ad Format, Position, ASIN, Title, Price, Rating,
Reviews, Delivery Days, Delivery Text, Scraped At.

`Position` is the product's place in true page reading order (top to bottom,
left to right), so "first 5 sponsored" means first on the page.

`Ad Format` says which ad placement it came from:

- **Sponsored Brands** — the brand banner above the grid. Amazon doesn't render
  a review count or delivery estimate in those tiles, so those two columns are
  blank by design; ASIN, title, price and rating are still captured.
- **Sponsored Products** — a normal grid card with a "Sponsored" badge. Full data.
- *(blank)* — organic.

**Summary** — one row per keyword: sponsored and organic counts, `OK`/`FAILED`,
and the error if it failed.

By default each keyword contributes up to 5 sponsored + 5 organic rows.

---

## Settings (`.env`)

Open `.env` in Notepad. Everything is optional; the defaults work.

| Setting | Default | What it does |
| --- | --- | --- |
| `INPUT_FILE` | `keywords.xlsx` | Keywords workbook (a dragged-on file wins) |
| `OUTPUT_FILE` | `results-<timestamp>.xlsx` | Where results go |
| `DEFAULT_SHORT_CODE` | `AZIN` | Marketplace for rows without one |
| `SCRAPE_DELAY_MS` | `30000` | Pause between keywords — don't lower it much for long lists |
| `BROWSER_VISIBLE` | off | `1` to watch Chrome work |
| `TOP_N_RESULTS` | `20` | Result cards read per search page |
| `MAX_SPONSORED` / `MAX_ORGANIC` | `5` / `5` | Rows per keyword; `0` = no cap |
| `INCLUDE_SPONSORED_BRANDS` | on | `0` to count only grid cards |
| `SCRAPER_PROFILE_DIR` | `chrome-profile` | Chrome profile location |

At 30 s per keyword, 100 keywords take roughly an hour. That delay is what keeps
Amazon from serving bot checks — lower it only for short test runs.

---

## Troubleshooting

**The window flashes and closes** — you started the .exe directly. Use
`run.bat`; it keeps the window open so you can read what went wrong.

**"Input file not found"** — `keywords.xlsx` isn't in this folder, or
`INPUT_FILE` in `.env` points somewhere wrong.

**"EBUSY" / can't write the results file** — the results workbook is open in
Excel. Close it and run again.

**"No search results loaded … (possible CAPTCHA or block page)"** — Amazon
served a bot check. Set `BROWSER_VISIBLE=1` in `.env`, run again, solve it once
in the window; the profile remembers. Raising `SCRAPE_DELAY_MS` makes it rarer.

**Price / Delivery columns empty** — you're signed out, or no delivery pincode is
set. Delete the `chrome-profile` folder and run again to redo the sign-in step.

**Reviews / Delivery blank on some sponsored rows** — check the Ad Format
column. Sponsored Brands tiles don't render those fields; blank is correct.

**`run.bat` says Google Chrome NOT FOUND** — Chrome isn't installed, or is
installed only for a different Windows user. Install the standard 64-bit Chrome
from <https://www.google.com/chrome/> and run again.

**Moving to another PC** — copy the folder, but leave `chrome-profile` behind;
it holds this machine's Amazon session and a fresh one is created on first run.
