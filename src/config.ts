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
  topNResults: 10,
  defaultAmazonDomain: process.env.DEFAULT_AMAZON_DOMAIN || 'www.amazon.in',
  queriesApiUrl: process.env.QUERIES_API_URL || '',
  resultsApiUrl: process.env.RESULTS_API_URL || '',
  apiToken: process.env.API_TOKEN || '',
};

export function userSettingsPath(): string {
  return path.join(config.profileDir, 'user-settings.json');
}
