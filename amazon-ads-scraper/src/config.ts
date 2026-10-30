import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import {
  EMBEDDED_API_ROOT,
  EMBEDDED_AUTH_ROOT,
  QUERY_ENDPOINT,
  RESULTS_ENDPOINT,
} from './embedded';

dotenv.config();

/**
 * Where the exe actually lives on disk. `pkg` rewrites __dirname into its
 * virtual snapshot, so the real folder has to come from the exe path.
 */
export function appDir(): string {
  const isPackaged = Boolean((process as unknown as { pkg?: unknown }).pkg);
  return isPackaged ? path.dirname(process.execPath) : process.cwd();
}

function defaultProfileDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'SearchTermScrapper', 'chrome-profile');
}

// API root: env override first (lets a built exe be pointed at staging via a
// .env), else the value baked in at build time. Trailing slashes stripped so
// joining an endpoint never produces a double slash.
const API_ROOT = (process.env.VH_API_ROOT?.trim() || EMBEDDED_API_ROOT).replace(/\/+$/, '');

export const config = {
  profileDir: process.env.SCRAPER_PROFILE_DIR?.trim() || defaultProfileDir(),
  chromeChannel: 'chrome' as const,
  /**
   * Rendering width matters for WHAT the page shows: it decides how many
   * Sponsored Brands carousel slots are on screen and how many columns the
   * result grid uses, which changes the composition of "the first five
   * sponsored". Chrome was falling back to 1280 here (the --window-size flag
   * does not survive off-screen positioning on every OS), so results differed
   * from a normal desktop browser AND could differ between machines.
   * Pinning it makes runs reproducible.
   */
  /**
   * SAVE_SCREENSHOTS=1 writes a PNG of each search page, exactly as the
   * scraper saw it, next to the exe (or SCREENSHOT_DIR). Sponsored slots are
   * re-auctioned over time and vary with window width and account, so a
   * manual check minutes later legitimately shows different ASINs — this is
   * the only way to audit what was actually on the page at scrape time.
   */
  saveScreenshots: process.env.SAVE_SCREENSHOTS === '1',
  screenshotDir: process.env.SCREENSHOT_DIR?.trim() || '',
  viewportWidth: Number(process.env.VIEWPORT_WIDTH || 1920),
  viewportHeight: Number(process.env.VIEWPORT_HEIGHT || 1080),
  scrapeDelayMs: Number(process.env.SCRAPE_DELAY_MS || 14_000),
  navigationTimeoutMs: 30_000,
  resultsWaitTimeoutMs: 20_000,
  /**
   * How many of each bucket the backend wants: 5 sponsored + 5 organic.
   */
  productsPerBucket: 5,
  /**
   * Upper bound on cards inspected per search page. The scraper stops as soon
   * as both buckets are full, so this only matters when a page is skewed
   * (all-ads at the top, or almost no ads at all) — it is a safety net, not
   * the normal path.
   *
   * It replaced a flat "first 20 cards" cap, which silently truncated a bucket
   * whenever the top of the page was lopsided.
   */
  maxCardsToScan: 60,
  /**
   * Include products from Sponsored Brands banners — the brand ad above the
   * grid, which is not an `s-search-result` card. These ARE the page's first
   * sponsored placements, so counting them gives a truer "first 5 sponsored".
   *
   * OFF. Banner tiles now yield rating and review count (read from the
   * "Rated 3.8 out of 5 stars from 458 reviews" aria-label), but Amazon
   * renders NO delivery estimate inside them, and the backend treats delivery
   * as required.
   *
   * Measured on "jug for water" with this ON: the three banner rows were
   * dropped for missing delivery, the backend pulled three ORGANIC rows up
   * into comp3..5 to backfill, then had too few organic left to fill org1..5
   * and wrote none — competitors polluted AND organic emptied.
   *
   * Turning this on requires delivery for banner ASINs, which means fetching
   * each product page — see the note in extractors.ts. Until then, grid cards
   * only. Set INCLUDE_SPONSORED_BRANDS=1 to re-enable.
   *
   * VentaWiz also rules banners out: only sponsored products in the grid
   * compete with our listing, so comp1..5 must never hold a banner tile.
   */
  includeSponsoredBrands: process.env.INCLUDE_SPONSORED_BRANDS === '1',
  /**
   * Banner ads carry no delivery estimate, and the backend treats delivery as
   * required — a row without it is dropped and comp slots get backfilled from
   * organic, which then drains the organic bucket too.
   *
   * Enrichment runs in two stages. First, free: every grid card on the page is
   * indexed and used to fill a banner product's blanks (about half of banner
   * ASINs appear in the grid, sometimes as far down as card 60). Anything
   * still missing delivery AND inside the reported buckets falls back to
   * opening its product page — one navigation per ASIN, capped below.
   *
   * ENRICH_PRODUCT_PAGES=0 disables only the navigating stage.
   */
  enrichFromProductPages: process.env.ENRICH_PRODUCT_PAGES !== '0',
  /** Hard cap on product-page fetches per keyword, so a bad page can't stall a run. */
  maxProductPageFetches: Number(process.env.MAX_PRODUCT_PAGE_FETCHES || 5),
  defaultAmazonDomain: process.env.DEFAULT_AMAZON_DOMAIN || 'www.amazon.in',
  queriesApiUrl: process.env.QUERIES_API_URL || `${API_ROOT}${QUERY_ENDPOINT}`,
  resultsApiUrl: process.env.RESULTS_API_URL || `${API_ROOT}${RESULTS_ENDPOINT}`,
  // VentaWiz service account (OAuth client_credentials, see src/api/auth.ts).
  // The agent passes all three to every child; a standalone run reads them
  // from the .env. The secret is never logged.
  authRoot: (process.env.VW_AUTH_URL?.trim() || EMBEDDED_AUTH_ROOT).replace(/\/+$/, ''),
  clientId: process.env.VW_CLIENT_ID?.trim() || '',
  clientSecret: process.env.VW_CLIENT_SECRET?.trim() || '',
  /**
   * Store ids handed over by the VentaWiz agent (SCRAPE_STORE_IDS=13,16).
   * When set they win over user-settings.json and the first-run form is
   * skipped. Empty = fall back to the saved settings.
   */
  envStoreIds: parseStoreIds(process.env.SCRAPE_STORE_IDS || '').ids,
  /** Sent as `marketplace=` on every queue request, so only our stores come back. */
  marketplace: (process.env.SCRAPE_MARKETPLACE?.trim().toLowerCase() || 'amazon'),
  /**
   * Optional comma-separated list of marketplace short codes to scrape.
   * When set, queue items from any other marketplace are skipped. Empty = all.
   * Example: SCRAPE_SHORT_CODES=AZUS,AZUK
   */
  shortCodeFilter: (process.env.SCRAPE_SHORT_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

export function userSettingsPath(): string {
  return path.join(config.profileDir, 'user-settings.json');
}

/**
 * Parse VentaWiz store ids from free text — one per line or comma-separated.
 * Store ids are positive integers; anything else is returned in `invalid` so
 * the caller can say exactly what was rejected.
 */
export function parseStoreIds(input: string | Array<string | number>): {
  ids: number[];
  invalid: string[];
} {
  const tokens = (Array.isArray(input) ? input.map(String) : input.split(/[\n,]+/))
    .map((s) => s.trim())
    .filter(Boolean);
  const ids: number[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    const n = /^\d+$/.test(t) ? Number(t) : NaN;
    if (Number.isSafeInteger(n) && n > 0) {
      if (!ids.includes(n)) ids.push(n);
    } else {
      invalid.push(t);
    }
  }
  return { ids, invalid };
}
