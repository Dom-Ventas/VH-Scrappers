/**
 * One-command end-to-end test:  npm run dev-api
 *
 * Boots the mock backend, runs a full scrape against it, prints a summary of
 * what the backend received, then shuts down. No second terminal, no .env
 * edits, and no interactive first-run prompt.
 *
 * Isolation notes — this deliberately does NOT touch your normal setup:
 *   - Chrome profile lives in .dev-profile/ (gitignored), not the real
 *     %LOCALAPPDATA% profile, so your saved eBay location and onboarding
 *     state are left alone.
 *   - user-settings.json is seeded there so the run never drops into the
 *     first-launch form.
 *   - API URLs/token are passed as env vars, overriding .env for this run only.
 *
 * Products scraped come from mock/queries.json — edit that to change the set.
 * Rows are { store_id, short_code, mp_product_id (item number), product_ids }, the
 * same shape the VentaWiz queue returns.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startMockServer } from '../mock/server';

const PORT = Number(process.env.MOCK_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}/v1/scrapper`;

const ROOT = path.join(__dirname, '..');
const DEV_PROFILE_DIR = path.join(ROOT, '.dev-profile');
const RECEIVED_DIR = path.join(ROOT, 'mock', 'received');
const SEED_PATH = path.join(ROOT, 'mock', 'queries.json');

function storeIdsFromSeed(): number[] {
  if (process.env.DEV_STORE_IDS) {
    return process.env.DEV_STORE_IDS.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8')) as Array<{ store_id: number }>;
  return [...new Set(seed.map((r) => r.store_id))];
}

function seedSettings(storeIds: number[]): void {
  fs.mkdirSync(DEV_PROFILE_DIR, { recursive: true });
  const file = path.join(DEV_PROFILE_DIR, 'user-settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        emailId: process.env.DEV_EMAIL_ID || 'dev@example.com',
        storeIds,
        firstRunCompletedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`[DEV-API] seeded ${path.relative(ROOT, file)} (storeIds=[${storeIds.join(', ')}])`);
}

function runScraper(storeIds: number[]): Promise<number> {
  return new Promise((resolve) => {
    // shell:true so this resolves npx/npx.cmd on both POSIX and Windows.
    const child = spawn('npx tsx src/index.ts', {
      cwd: ROOT,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QUERIES_API_URL: `${BASE}/review-queries`,
        RESULTS_API_URL: `${BASE}/reviews`,
        // The mock also stands in for DV-Auth's token exchange.
        VW_AUTH_URL: `http://127.0.0.1:${PORT}`,
        VW_CLIENT_ID: 'svc_dev',
        VW_CLIENT_SECRET: 'vws_dev',
        SCRAPE_STORE_IDS: storeIds.join(','),
        SCRAPE_MARKETPLACE: 'ebay',
        SCRAPER_PROFILE_DIR: DEV_PROFILE_DIR,
        // Keep the dev loop quick; production defaults to 30s / 100.
        SCRAPE_DELAY_MS: process.env.SCRAPE_DELAY_MS || '2000',
        MAX_CRITICAL_REVIEWS: process.env.MAX_CRITICAL_REVIEWS || '20',
      },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function summarise(): number {
  if (!fs.existsSync(RECEIVED_DIR)) {
    console.log('\n[DEV-API] no results were accepted by the mock backend.');
    return 1;
  }
  const files = fs.readdirSync(RECEIVED_DIR).filter((f) => f.endsWith('.json'));
  const rows = files.map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(RECEIVED_DIR, f), 'utf-8'));
    const reviews = d.critical_reviews?.reviews ?? [];
    return {
      file: f.replace(/\.json$/, ''),
      productIds: d.product_ids.join(','),
      rating: d.rating,
      ratingCount: d.rating_count,
      critical: reviews.length,
      oneStar: reviews.filter((r: any) => r.rating === 1).length,
      deliveryDays: d.delivery_promise_days,
      price: d.price,
    };
  });

  console.log(`\n[DEV-API] mock backend accepted ${rows.length} result(s):`);
  console.table(rows);
  console.log(`[DEV-API] full payloads: ${path.relative(ROOT, RECEIVED_DIR)}/`);
  return rows.length > 0 ? 0 : 1;
}

async function main(): Promise<void> {
  fs.rmSync(RECEIVED_DIR, { recursive: true, force: true });

  const storeIds = storeIdsFromSeed();
  if (storeIds.length === 0) {
    console.error('[DEV-API] mock/queries.json defines no store ids — nothing to scrape.');
    process.exit(1);
  }

  let server: import('http').Server | null = null;
  try {
    server = await startMockServer(PORT);
  } catch (err: any) {
    if (err?.code !== 'EADDRINUSE') throw err;
    const healthy = await fetch(`http://127.0.0.1:${PORT}/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (!healthy) {
      console.error(
        `[DEV-API] port ${PORT} is in use by something that isn't the mock backend.\n` +
          `[DEV-API] Stop it, or pick another port: MOCK_PORT=8792 npm run dev-api`,
      );
      process.exit(1);
    }
    console.log(`[DEV-API] reusing the mock backend already running on :${PORT}`);
  }

  seedSettings(storeIds);
  console.log('[DEV-API] starting scrape...\n');

  const code = await runScraper(storeIds);
  const summaryCode = summarise();

  server?.close();
  process.exit(code === 0 ? summaryCode : code);
}

main().catch((err) => {
  console.error('[DEV-API] FATAL', err);
  process.exit(1);
});
