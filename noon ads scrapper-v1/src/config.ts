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
  return path.join(localAppData, 'NoonSearchTermScrapper', 'chrome-profile');
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
  // VentaWiz service account (OAuth client_credentials, see src/api/auth.ts).
  // The agent passes all three to every child; a standalone run reads them
  // from the .env. The secret is never logged.
  authRoot: (process.env.VW_AUTH_URL?.trim() || EMBEDDED_AUTH_ROOT).replace(/\/+$/, ''),
  clientId: process.env.VW_CLIENT_ID?.trim() || '',
  clientSecret: process.env.VW_CLIENT_SECRET?.trim() || '',
  /**
   * VentaWiz store ids set by the agent (SCRAPE_STORE_IDS=13,16). When set
   * they win over user-settings.json and the first-run form is not needed.
   */
  envStoreIds: parseStoreIds(process.env.SCRAPE_STORE_IDS || '', 'SCRAPE_STORE_IDS'),
  /** Sent as `marketplace=` on the queue request so only noon stores come back. */
  marketplace: (process.env.SCRAPE_MARKETPLACE || 'noon').trim().toLowerCase() || 'noon',
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
