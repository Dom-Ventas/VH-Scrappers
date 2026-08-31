import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

function isPackaged(): boolean {
  return (
    (process as any).pkg !== undefined ||
    (process as any).nexe !== undefined
  );
}

/**
 * A packaged binary chdir()s to its own folder, so a bare dotenv.config() only
 * ever sees a .env sitting next to the binary. Look next to the exe AND in the
 * folder the user launched it from, so the same .env works either way.
 * First file wins — dotenv never overwrites an already-set variable.
 */
function loadEnvFiles(): string[] {
  const candidates = [
    path.join(path.dirname(process.execPath), '.env'),
    path.join(process.cwd(), '.env')
  ];

  const loaded: string[] = [];

  for (const file of candidates) {
    if (
      !loaded.includes(file) &&
      fs.existsSync(file)
    ) {
      dotenv.config({ path: file });
      loaded.push(file);
    }
  }

  return loaded;
}

export const envFilesLoaded = isPackaged()
  ? loadEnvFiles()
  : (dotenv.config().parsed
      ? [path.join(process.cwd(), '.env')]
      : []);

function defaultProfileDir(): string {
  const baseDir =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), 'AppData', 'Local');

  return path.join(
    baseDir,
    'NoonReviewScraper',
    'chrome-profile'
  );
}

export const config = {
  // Resolved to an absolute path so "./chrome-profile" cannot silently point at
  // a different folder depending on where the process was started from.
  profileDir: path.resolve(
    process.env.SCRAPER_PROFILE_DIR?.trim() ||
      defaultProfileDir()
  ),

  chromeChannel: 'chrome',

  scrapeDelayMs: Number(
    process.env.SCRAPE_DELAY_MS || 30000
  ),

  navigationTimeoutMs: 30000,

  resultsWaitTimeoutMs: 20000,

  /** Safety cap on scroll/load-more rounds on the reviews page. */
  maxReviewPages: 100,

  maxCriticalReviews: Number(
    process.env.MAX_CRITICAL_REVIEWS || 200
  ),

  defaultNoonLocale:
    process.env.DEFAULT_NOON_LOCALE ||
    'www.noon.com/uae-en',

  queriesApiUrl:
    process.env.QUERIES_API_URL ||
    'http://localhost:4000/api/v1/scrapper/noon/review-queries',

  resultsApiUrl:
    process.env.RESULTS_API_URL ||
    'http://localhost:4000/api/v1/scrapper/noon/reviews',

  apiToken:
    process.env.API_TOKEN ||
    'dev-local-token',

  shortCodeFilter: (
    process.env.SCRAPE_SHORT_CODES || ''
  )
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
};

export function userSettingsPath(): string {
  return path.join(
    config.profileDir,
    'user-settings.json'
  );
}
