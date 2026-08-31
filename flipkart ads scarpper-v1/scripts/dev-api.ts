/**
 * One-command end-to-end test:  npm run dev-api
 *
 * Boots the mock backend, runs a full scrape against it, prints a summary of
 * what the backend received, then shuts down. No second terminal, no .env
 * edits, and no interactive first-run prompt.
 *
 * Isolation notes — this deliberately does NOT touch your normal setup:
 *   - Chrome profile lives in .dev-profile/ (gitignored), not the real
 *     %LOCALAPPDATA% profile, so your saved Flipkart login and onboarding
 *     state are left alone.
 *   - user-settings.json is seeded there so the run never drops into the
 *     first-launch form.
 *   - API URLs/token are passed as env vars, overriding .env for this run only.
 *
 * Keywords scraped come from mock/queries.json — edit that to change the set.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { startMockServer } from '../mock/server';

const PORT = Number(process.env.MOCK_PORT || 8787);
const BASE = `http://127.0.0.1:${PORT}/backend/api/v1/scrapper`;
const TOKEN = process.env.MOCK_API_TOKEN || 'dummy-local-token';

const ROOT = path.join(__dirname, '..');
const DEV_PROFILE_DIR = path.join(ROOT, '.dev-profile');
const RECEIVED_DIR = path.join(ROOT, 'mock', 'received');
const SEED_PATH = path.join(ROOT, 'mock', 'queries.json');

/**
 * Scrape whichever profiles mock/queries.json actually defines. Deriving this
 * instead of hardcoding means renaming the profile key in queries.json can't
 * leave dev-api asking for one that no longer exists and silently getting back
 * zero queries.
 */
function profileIdsFromSeed(): string[] {
  if (process.env.DEV_PROFILE_ID) return [process.env.DEV_PROFILE_ID];
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8')) as Record<string, unknown[]>;
  return Object.keys(seed);
}

function seedSettings(profileIds: string[]): void {
  fs.mkdirSync(DEV_PROFILE_DIR, { recursive: true });
  const file = path.join(DEV_PROFILE_DIR, 'user-settings.json');
  // Always rewritten (not written-once) so an edit to queries.json can't leave
  // a stale profile id behind in the throwaway dev profile.
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        emailId: process.env.DEV_EMAIL_ID || 'dev@example.com',
        profileIds,
        firstRunCompletedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(
    `[DEV-API] seeded ${path.relative(ROOT, file)} (profileIds=[${profileIds.join(', ')}])`,
  );
}

function runScraper(): Promise<number> {
  return new Promise((resolve) => {
    // shell:true so this resolves npx/npx.cmd on both POSIX and Windows.
    const child = spawn('npx tsx src/index.ts', {
      cwd: ROOT,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        QUERIES_API_URL: `${BASE}/queries`,
        RESULTS_API_URL: `${BASE}/results`,
        API_TOKEN: TOKEN,
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
    const sponsored = d.products.filter((p: any) => p.isSponsored);
    const organic = d.products.filter((p: any) => !p.isSponsored);
    return {
      keyword: d.searchTerm,
      queryId: d.queryId,
      products: d.products.length,
      sponsored: sponsored.length,
      organic: organic.length,
      withPrice: d.products.filter((p: any) => p.price).length,
      withRating: d.products.filter((p: any) => p.rating !== null).length,
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

  const profileIds = profileIdsFromSeed();
  if (profileIds.length === 0) {
    console.error('[DEV-API] mock/queries.json defines no profiles — nothing to scrape.');
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
          `[DEV-API] Stop it, or pick another port: MOCK_PORT=8788 npm run dev-api`,
      );
      process.exit(1);
    }
    console.log(`[DEV-API] reusing the mock backend already running on :${PORT}`);
  }

  seedSettings(profileIds);
  console.log('[DEV-API] starting scrape...\n');

  const code = await runScraper();
  const summaryCode = summarise();

  // Only shut down a server we started; leave a borrowed one running.
  server?.close();
  process.exit(code === 0 ? summaryCode : code);
}

main().catch((err) => {
  console.error('[DEV-API] FATAL', err);
  process.exit(1);
});
