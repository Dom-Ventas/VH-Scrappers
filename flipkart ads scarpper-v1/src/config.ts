import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

dotenv.config();

function defaultProfileDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'FlipkartSearchTermScrapper', 'chrome-profile');
}

export const config = {
  profileDir: process.env.SCRAPER_PROFILE_DIR?.trim() || defaultProfileDir(),
  chromeChannel: 'chrome' as const,
  scrapeDelayMs: Number(process.env.SCRAPE_DELAY_MS || 30_000),
  navigationTimeoutMs: 30_000,
  resultsWaitTimeoutMs: 20_000,
  topNResults: 20,
  defaultFlipkartDomain: process.env.DEFAULT_FLIPKART_DOMAIN || 'www.flipkart.com',
  // Endpoints intentionally left blank for now — fill these in via .env once the
  // backend routes are ready. See src/api/queries.ts and src/api/results.ts for
  // the fallback behaviour when they are empty.
  queriesApiUrl: process.env.QUERIES_API_URL || '',
  resultsApiUrl: process.env.RESULTS_API_URL || '',
  apiToken: process.env.API_TOKEN || '',
  /**
   * Optional comma-separated list of marketplace short codes to scrape.
   * When set, queries from any other marketplace are skipped. Empty = all.
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
