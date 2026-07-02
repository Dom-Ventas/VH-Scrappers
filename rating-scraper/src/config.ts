import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

dotenv.config();

function defaultProfileDir(): string {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), 'AppData', 'Local');

  return path.join(
    localAppData,
    'AmazonReviewScraper',
    'chrome-profile'
  );
}

export const config = {
  profileDir:
    process.env.SCRAPER_PROFILE_DIR?.trim() ||
    defaultProfileDir(),

  chromeChannel: 'chrome',

  scrapeDelayMs: Number(
    process.env.SCRAPE_DELAY_MS || 30000
  ),

  navigationTimeoutMs: 30000,

  resultsWaitTimeoutMs: 20000,

  maxReviewPages: 100,

  maxCriticalReviews: 1000,  

  defaultAmazonDomain:
    process.env.DEFAULT_AMAZON_DOMAIN ||
    'www.amazon.in',

  queriesApiUrl:
    process.env.QUERIES_API_URL || '',

  resultsApiUrl:
    process.env.RESULTS_API_URL || '',

  apiToken:
    process.env.API_TOKEN || '',

  shortCodeFilter: (
    process.env.SCRAPE_SHORT_CODES || ''
  )
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
};

if (!config.apiToken) {
  throw new Error(
    'API_TOKEN missing in .env'
  );
}

if (!config.queriesApiUrl) {
  throw new Error(
    'QUERIES_API_URL missing in .env'
  );
}

if (!config.resultsApiUrl) {
  throw new Error(
    'RESULTS_API_URL missing in .env'
  );
}

export function userSettingsPath(): string {
  return path.join(
    config.profileDir,
    'user-settings.json'
  );
}