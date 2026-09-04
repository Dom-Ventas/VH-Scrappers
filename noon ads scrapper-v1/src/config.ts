import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import {
  EMBEDDED_API_ROOT,
  EMBEDDED_TOKEN,
  QUERY_ENDPOINT,
  RESULTS_ENDPOINT,
} from './embedded';

dotenv.config();

function defaultProfileDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'NoonSearchTermScrapper', 'chrome-profile');
}

// API root: env override first (lets a built exe be pointed at staging via a
// .env), else the value baked in at build time. Trailing slashes stripped so
// joining an endpoint never produces a double slash.
const API_ROOT = (process.env.VH_API_ROOT?.trim() || EMBEDDED_API_ROOT).replace(/\/+$/, '');

export const config = {
  profileDir: process.env.SCRAPER_PROFILE_DIR?.trim() || defaultProfileDir(),
  chromeChannel: 'chrome' as const,
  scrapeDelayMs: Number(process.env.SCRAPE_DELAY_MS || 30_000),
  navigationTimeoutMs: 30_000,
  resultsWaitTimeoutMs: 20_000,
  topNResults: 20,
  defaultNoonDomain: process.env.DEFAULT_NOON_DOMAIN || 'www.noon.com',
  /**
   * Storefront the first-run page opens so the user can sign in and pick a
   * delivery address. Noon scopes every route by country+language, so the
   * locale segment is part of the URL, not a cookie.
   */
  defaultNoonLocale: process.env.DEFAULT_NOON_LOCALE || 'uae-en',
  // Defaults come from src/embedded.ts (API root + endpoint paths). The agent
  // overrides both from the backend's assignment when it launches this scraper;
  // these are the fallback for a standalone run.
  queriesApiUrl: process.env.QUERIES_API_URL || `${API_ROOT}${QUERY_ENDPOINT}`,
  resultsApiUrl: process.env.RESULTS_API_URL || `${API_ROOT}${RESULTS_ENDPOINT}`,
  apiToken: process.env.API_TOKEN || EMBEDDED_TOKEN,
  /**
   * Optional comma-separated list of marketplace short codes to scrape.
   * When set, queries from any other marketplace are skipped. Empty = all.
   * Example: SCRAPE_SHORT_CODES=NNAE
   */
  shortCodeFilter: (process.env.SCRAPE_SHORT_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

export function userSettingsPath(): string {
  return path.join(config.profileDir, 'user-settings.json');
}
