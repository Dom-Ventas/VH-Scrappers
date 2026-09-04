import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import {
  EMBEDDED_API_ROOT,
  EMBEDDED_TOKEN,
  QUERY_ENDPOINT,
  RESULTS_ENDPOINT,
} from './embedded';

function isPackaged(): boolean {
  return (
    (process as any).pkg !== undefined ||
    (process as any).nexe !== undefined
  );
}

/**
 * A packaged .exe chdir()s to its own folder, so a bare dotenv.config() only
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
    'FlipkartReviewScraper',
    'chrome-profile'
  );
}

/** Where local queries.json / results/ live: next to the exe, or the CWD. */
export function dataDir(): string {
  return isPackaged()
    ? path.dirname(process.execPath)
    : process.cwd();
}

function numberFromEnv(
  name: string,
  fallback: number
): number {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  return Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

// API root: env override first (lets a built exe be pointed at staging via a
// .env), else the value baked in at build time. Trailing slashes stripped so
// joining an endpoint never produces a double slash.
const API_ROOT = (process.env.VH_API_ROOT?.trim() || EMBEDDED_API_ROOT).replace(/\/+$/, '');

export const config = {
  // Resolved to an absolute path so "./chrome-profile" cannot silently point at
  // a different folder depending on where the process was started from.
  profileDir: path.resolve(
    process.env.SCRAPER_PROFILE_DIR?.trim() ||
      defaultProfileDir()
  ),

  chromeChannel: 'chrome',

  scrapeDelayMs: numberFromEnv('SCRAPE_DELAY_MS', 5000),

  // Flipkart throttles harder than Amazon, and with no server-side critical
  // filter one product can cost maxReviewPages requests.
  reviewPageDelayMs: numberFromEnv('REVIEW_PAGE_DELAY_MS', 1500),

  navigationTimeoutMs: 30000,

  resultsWaitTimeoutMs: 20000,

  // Flipkart serves 10 reviews per page and offers no critical-only filter, so
  // these bound the crawl instead of Amazon's much larger limits.
  maxReviewPages: numberFromEnv('MAX_REVIEW_PAGES', 30),

  maxCriticalReviews: numberFromEnv('MAX_CRITICAL_REVIEWS', 200),

  defaultFlipkartDomain:
    process.env.DEFAULT_FLIPKART_DOMAIN?.trim() ||
    'www.flipkart.com',

  // Any in-stock product works; this one is only loaded by `--setup` to read
  // back whether a delivery location actually stuck.
  pincodeCheckPid:
    process.env.PINCODE_CHECK_PID?.trim() ||
    'ACCGJP5QSJFP7HAP',

  // Backend integration is pending. Empty means LOCAL mode: queries are read
  // from queries.json and results are written to results/*.jsonl. Filling these
  // in switches to API mode with no code change.
  queriesApiUrl:
    process.env.QUERIES_API_URL?.trim() || `${API_ROOT}${QUERY_ENDPOINT}`,

  resultsApiUrl:
    process.env.RESULTS_API_URL?.trim() || `${API_ROOT}${RESULTS_ENDPOINT}`,

  apiToken:
    process.env.API_TOKEN?.trim() || EMBEDDED_TOKEN,

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

export function localQueriesPath(): string {
  return path.join(dataDir(), 'queries.json');
}

export function localResultsDir(): string {
  return path.join(dataDir(), 'results');
}
