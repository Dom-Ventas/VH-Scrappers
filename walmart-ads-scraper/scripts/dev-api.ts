/**
 * One-command end-to-end test:  npm run dev-api
 *
 * Boots the mock backend, runs a full scrape against it, prints a summary of
 * what the backend received, then shuts down. No second terminal, no .env
 * edits, and no interactive first-run prompt.
 *
 * Isolation notes — this deliberately does NOT touch your normal setup:
 *   - Chrome profile lives in .dev-profile/ (gitignored), not the real
 *     %LOCALAPPDATA% profile, so your saved Walmart location and onboarding
 *     state are left alone.
 *   - user-settings.json is seeded there so the run never drops into the
 *     first-launch form.
 *   - API URLs/token are passed as env vars, overriding .env for this run only.
 *
 * Search terms scraped come from mock/queries.json — edit that to change the
 * set. It is a flat list of { store_id, short_code, search_term } rows, the
 * same shape the VentaWiz queue returns.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startMockServer } from '../mock/server';

const PORT = Number(process.env.MOCK_PORT || 8789);
const BASE = `http://127.0.0.1:${PORT}/v1/scrapper`;

const ROOT = path.join(__dirname, '..');
const DEV_PROFILE_DIR = path.join(ROOT, '.dev-profile');
const RECEIVED_DIR = path.join(ROOT, 'mock', 'received');
const SEED_PATH = path.join(ROOT, 'mock', 'queries.json');

/**
 * Scrape whichever stores mock/queries.json actually defines. Deriving this
 * instead of hardcoding means changing the store id in queries.json can't
 * leave dev-api asking for one that no longer exists and silently getting back
 * zero queries.
 */
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
  // Always rewritten (not written-once) so an edit to queries.json can't leave
  // a stale store id behind in the throwaway dev profile.
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
  console.log(
    `[DEV-API] seeded ${path.relative(ROOT, file)} (storeIds=[${storeIds.join(', ')}])`,
  );
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
        QUERIES_API_URL: `${BASE}/search-term-queries`,
        RESULTS_API_URL: `${BASE}/search-term-results`,
        // The mock also stands in for DV-Auth's token exchange.
        VW_AUTH_URL: `http://127.0.0.1:${PORT}`,
        VW_CLIENT_ID: 'svc_dev',
        VW_CLIENT_SECRET: 'vws_dev',
        SCRAPE_STORE_IDS: storeIds.join(','),
        SCRAPE_MARKETPLACE: 'walmart',
        SCRAPER_PROFILE_DIR: DEV_PROFILE_DIR,
        // Keep the dev loop quick; production defaults to 30s.
        SCRAPE_DELAY_MS: process.env.SCRAPE_DELAY_MS || '2000',
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
    const sponsored = d.products.filter((p: any) => p.is_sponsored);
    const organic = d.products.filter((p: any) => !p.is_sponsored);
    return {
      searchTerm: d.search_term,
      storeId: d.store_id,
      products: d.products.length,
      sponsored: sponsored.length,
      organic: organic.length,
      withPrice: d.products.filter((p: any) => p.price).length,
      withRating: d.products.filter((p: any) => p.rating !== null).length,
      withDelivery: d.products.filter((p: any) => p.delivery_days !== null).length,
    };
  });

  console.log(`\n[DEV-API] mock backend accepted ${rows.length} result(s):`);
  console.table(rows);
  console.log(`[DEV-API] full payloads: ${path.relative(ROOT, RECEIVED_DIR)}/`);
  return rows.length > 0 ? 0 : 1;
}

async function main(): Promise<void> {
  // Start clean so the summary reflects only this run.
  fs.rmSync(RECEIVED_DIR, { recursive: true, force: true });

  const storeIds = storeIdsFromSeed();
  if (storeIds.length === 0) {
    console.error('[DEV-API] mock/queries.json defines no store ids — nothing to scrape.');
    process.exit(1);
  }

  // Reuse an already-running `npm run mock` rather than failing on EADDRINUSE —
  // having one open in another terminal is the common case, not an error.
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
          `[DEV-API] Stop it, or pick another port: MOCK_PORT=8790 npm run dev-api`,
      );
      process.exit(1);
    }
    console.log(`[DEV-API] reusing the mock backend already running on :${PORT}`);
  }

  seedSettings(storeIds);
  console.log('[DEV-API] starting scrape...\n');

  const code = await runScraper(storeIds);
  const summaryCode = summarise();

  // Only shut down a server we started; leave a borrowed one running.
  server?.close();
  process.exit(code === 0 ? summaryCode : code);
}

main().catch((err) => {
  console.error('[DEV-API] FATAL', err);
  process.exit(1);
});
