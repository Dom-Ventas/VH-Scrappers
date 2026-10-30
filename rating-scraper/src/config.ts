import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import {
  EMBEDDED_API_ROOT,
  EMBEDDED_AUTH_ROOT,
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
    'AmazonReviewScraper',
    'chrome-profile'
  );
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

  scrapeDelayMs: Number(
    process.env.SCRAPE_DELAY_MS || 5000
  ),

  navigationTimeoutMs: 30000,

  resultsWaitTimeoutMs: 20000,

  maxReviewPages: 100,

  maxCriticalReviews: 1000,  

  defaultAmazonDomain:
    process.env.DEFAULT_AMAZON_DOMAIN ||
    'amazon.in',

  queriesApiUrl:
    process.env.QUERIES_API_URL ||
    `${API_ROOT}${QUERY_ENDPOINT}`,

  resultsApiUrl:
    process.env.RESULTS_API_URL ||
    `${API_ROOT}${RESULTS_ENDPOINT}`,

  // VentaWiz service account (OAuth client_credentials, see src/api/auth.ts).
  // The agent passes all three to every child; a standalone run reads them
  // from the .env. The secret is never logged.
  authRoot: (process.env.VW_AUTH_URL?.trim() || EMBEDDED_AUTH_ROOT).replace(/\/+$/, ''),
  clientId: process.env.VW_CLIENT_ID?.trim() || '',
  clientSecret: process.env.VW_CLIENT_SECRET?.trim() || '',

  /**
   * Store ids handed over by the VentaWiz agent (SCRAPE_STORE_IDS=13,16).
   * When set they win over user-settings.json and the first-run form is
   * skipped. Empty = fall back to the saved settings.
   */
  envStoreIds:
    parseStoreIds(
      process.env.SCRAPE_STORE_IDS || ''
    ).ids,

  /** Sent as `marketplace=` on every queue request, so only our stores come back. */
  marketplace:
    process.env.SCRAPE_MARKETPLACE?.trim().toLowerCase() ||
    'amazon',

  /** Optional local filter on the queue items' short_code. Empty = all. */
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

/**
 * Parse VentaWiz store ids from free text — one per line or comma-separated.
 * Store ids are positive integers; anything else is returned in `invalid` so
 * the caller can say exactly what was rejected.
 */
export function parseStoreIds(
  input: string | Array<string | number>
): { ids: number[]; invalid: string[] } {

  const tokens = (
    Array.isArray(input)
      ? input.map(String)
      : input.split(/[\n,]+/)
  )
    .map((s) => s.trim())
    .filter(Boolean);

  const ids: number[] = [];
  const invalid: string[] = [];

  for (const t of tokens) {
    const n = /^\d+$/.test(t) ? Number(t) : NaN;

    if (Number.isSafeInteger(n) && n > 0) {
      if (!ids.includes(n)) ids.push(n);
    } else {
      invalid.push(t);
    }
  }

  return { ids, invalid };
}
