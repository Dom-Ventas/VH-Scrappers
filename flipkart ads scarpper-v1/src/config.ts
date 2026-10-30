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
  return path.join(localAppData, 'FlipkartSearchTermScrapper', 'chrome-profile');
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
  defaultFlipkartDomain: process.env.DEFAULT_FLIPKART_DOMAIN || 'www.flipkart.com',
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
   * Sent as `marketplace=` on every queue request so the backend refuses any
   * store that is not a Flipkart store. The agent sets it from its assignment.
   */
  marketplace: (process.env.SCRAPE_MARKETPLACE?.trim().toLowerCase() || 'flipkart'),
  /**
   * VentaWiz store ids to scrape, from SCRAPE_STORE_IDS (comma-separated, set
   * by the agent). Raw string — parsed and validated by resolveStoreIds() in
   * src/userSettings.ts. Empty = use the ids saved at first run.
   */
  storeIdsEnv: process.env.SCRAPE_STORE_IDS?.trim() || '',
  /**
   * Optional comma-separated list of marketplace short codes to scrape.
   * When set, queue items from any other marketplace are skipped. Empty = all.
   * Example: SCRAPE_SHORT_CODES=FKIN
   */
  shortCodeFilter: (process.env.SCRAPE_SHORT_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};

export function userSettingsPath(): string {
  return path.join(config.profileDir, 'user-settings.json');
}
