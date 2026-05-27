import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

dotenv.config();

function defaultProfileDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'SearchTermScrapper', 'chrome-profile');
}

export const config = {
  profileDir: process.env.SCRAPER_PROFILE_DIR?.trim() || defaultProfileDir(),
  chromeChannel: 'chrome' as const,
  scrapeDelayMs: Number(process.env.SCRAPE_DELAY_MS || 30_000),
  navigationTimeoutMs: 30_000,
  resultsWaitTimeoutMs: 20_000,
  topNResults: 20,
  defaultAmazonDomain: process.env.DEFAULT_AMAZON_DOMAIN || 'www.amazon.in',
  queriesApiUrl: process.env.QUERIES_API_URL || 'https://domventas.online/backend/api/v1/scrapper/queries',
  resultsApiUrl: process.env.RESULTS_API_URL || 'https://domventas.online/backend/api/v1/scrapper/results',
  apiToken: process.env.API_TOKEN || '3d6fb5dee0f184f17cc9dbca224f54bf46e7a474361a9f75bca56d34f7dd1df5',
  /**
   * Optional comma-separated list of marketplace short codes to scrape.
   * When set, queries from any other marketplace are skipped. Empty = all.
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
