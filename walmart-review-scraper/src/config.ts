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

function defaultProfileDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'WalmartReviewScrapper', 'chrome-profile');
}

// API root: env override first (lets a built exe be pointed at staging via a
// .env), else the value baked in at build time. Trailing slashes stripped so
// joining an endpoint never produces a double slash.
const API_ROOT = (process.env.VH_API_ROOT?.trim() || EMBEDDED_API_ROOT).replace(/\/+$/, '');

/**
 * Parse VentaWiz store ids from a comma/newline separated string. Each must be
 * a positive integer; anything else is reported (so a typo in the agent's env
 * is visible in the log) and dropped. Duplicates are removed, order kept.
 */
export function parseStoreIds(raw: string, source: string): number[] {
  const ids: number[] = [];
  for (const token of raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) {
    const n = /^\d+$/.test(token) ? Number(token) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      console.warn(`[CONFIG] ${source}: ignoring "${token}" — store ids are positive integers`);
      continue;
    }
    if (!ids.includes(n)) ids.push(n);
  }
  return ids;
}

export const config = {
  profileDir: process.env.SCRAPER_PROFILE_DIR?.trim() || defaultProfileDir(),
  chromeChannel: 'chrome' as const,
  scrapeDelayMs: Number(process.env.SCRAPE_DELAY_MS || 30_000),
  navigationTimeoutMs: 30_000,
  resultsWaitTimeoutMs: 20_000,
  /**
   * Cap on critical (1–2 star) reviews collected per product. Walmart's review
   * page serves 10 per load, so this is also a cap on page loads per product —
   * and every load is one more roll of the dice with Walmart's bot check.
   */
  maxCriticalReviews: Number(process.env.MAX_CRITICAL_REVIEWS || 100),
  /** Safety cap on review pages per product, whatever the cap above says. */
  maxReviewPages: 20,
  /** Pause between review pages of one product. */
  reviewPageDelayMs: Number(process.env.REVIEW_PAGE_DELAY_MS || 2_000),
  /**
   * Host the first-run page opens so the user can set a delivery location
   * (and sign in, optionally). Walmart's delivery promise on the product page
   * depends on the store/zip the session resolved to, which Walmart keeps in
   * the persistent Chrome profile.
   */
  defaultWalmartDomain: process.env.DEFAULT_WALMART_DOMAIN || 'www.walmart.com',
  // Defaults come from src/embedded.ts (API root + endpoint paths). The agent
  // overrides both from the backend's assignment when it launches this scraper;
  // these are the fallback for a standalone run.
  queriesApiUrl: process.env.QUERIES_API_URL || `${API_ROOT}${QUERY_ENDPOINT}`,
  resultsApiUrl: process.env.RESULTS_API_URL || `${API_ROOT}${RESULTS_ENDPOINT}`,
  // VentaWiz service account. The agent passes these in; a standalone run
  // reads them from .env. Never baked into the exe.
  authRoot: (process.env.VW_AUTH_URL?.trim() || EMBEDDED_AUTH_ROOT).replace(/\/+$/, ''),
  clientId: process.env.VW_CLIENT_ID?.trim() || '',
  clientSecret: process.env.VW_CLIENT_SECRET?.trim() || '',
  /**
   * VentaWiz store ids set by the agent (SCRAPE_STORE_IDS=13,16). When set
   * they win over user-settings.json and the first-run form is not needed.
   */
  envStoreIds: parseStoreIds(process.env.SCRAPE_STORE_IDS || '', 'SCRAPE_STORE_IDS'),
  /** Sent as `marketplace=` on the queue request so only Walmart stores come back. */
  marketplace: (process.env.SCRAPE_MARKETPLACE || 'walmart').trim().toLowerCase() || 'walmart',
  /**
   * Optional comma-separated list of marketplace short codes to scrape.
   * When set, queries from any other marketplace are skipped. Empty = all.
   * Example: SCRAPE_SHORT_CODES=WMUS
   */
  shortCodeFilter: (process.env.SCRAPE_SHORT_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

export function userSettingsPath(): string {
  return path.join(config.profileDir, 'user-settings.json');
}
