import * as path from 'path';

// ─── EXE CWD BOOTSTRAP ────────────────────────────────────────────────────────
// When packaged the process starts with CWD wherever the user launched from.
// Playwright uses dynamic require() to load browsers.json and other runtime
// files, so pointing CWD at the binary's folder keeps those (and dotenv)
// resolving correctly.
if (
  (process as any).pkg !== undefined ||
  (process as any).nexe !== undefined
) {
  const exeDir = path.dirname(process.execPath);
  process.chdir(exeDir);
  console.log(`[BOOT] CWD set to exe dir: ${exeDir}`);
}
// ──────────────────────────────────────────────────────────────────────────────

import { openPersistentContext } from './browser';
import { config, envFilesLoaded } from './config';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { initLogger } from './logger';

import { credentialsProblem, serviceAccountId } from './api/auth';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';

import { scrapeSku } from './scraper';
import { resolveMarketplace } from './marketplaces';

import { retry } from './retry';
import { sleep } from './util';

async function main() {

  initLogger();

  console.log(
    `[BOOT] env file(s): ${
      envFilesLoaded.length
        ? envFilesLoaded.join(', ')
        : 'none found — using built-in defaults'
    }`
  );

  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] queries api: ${config.queriesApiUrl}`);
  console.log(`[BOOT] results api: ${config.resultsApiUrl}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);
  console.log(
    `[BOOT] max critical reviews per SKU: ${config.maxCriticalReviews}`
  );

  // Store ids come from the agent (SCRAPE_STORE_IDS) when it launched us,
  // else from user-settings.json. Only a standalone run with neither needs the
  // first-run form, which must be on-screen.
  const existingSettings = loadUserSettings();

  const needsFirstRun =
    config.envStoreIds.length === 0 &&
    !existingSettings;

  const visible =
    needsFirstRun ||
    process.env.BROWSER_VISIBLE === '1';

  console.log(
    `[BOOT] browser window: ${visible ? 'visible' : 'off-screen'}`
  );

  // No service account → nothing can be fetched or posted. Fail before
  // opening Chrome, keeping the [FAIL]/[DONE] markers the agent counts.
  const credentialsError = credentialsProblem();
  if (credentialsError) {
    console.error(`[FAIL] ${credentialsError}`);
    console.log('[DONE] no SKUs processed (no service-account credentials)');
    return;
  }
  console.log(`[BOOT] service account: ${serviceAccountId()} via ${config.authRoot}`);

  const context =
    await openPersistentContext({ visible });

  const page = await context.newPage();

  try {

    let storeIds: number[];

    if (config.envStoreIds.length > 0) {

      storeIds = config.envStoreIds;

      console.log(
        `[BOOT] store ids from SCRAPE_STORE_IDS: [${storeIds.join(', ')}]`
      );

    } else if (existingSettings) {

      storeIds = existingSettings.storeIds;

      console.log(
        `[BOOT] loaded settings: emailId="${existingSettings.emailId}" storeIds=[${storeIds.join(', ')}]`
      );

    } else {

      storeIds = (await runFirstLaunchFlow(page)).storeIds;
    }

    const scrapePage =
      page.isClosed()
        ? await context.newPage()
        : page;

    console.log(
      `[QUEUE] fetching SKUs for ${storeIds.length} store(s), marketplace=${config.marketplace}`
    );

    let queries;

    try {

      queries = await fetchQueries(storeIds);

    } catch (err) {

      console.error(
        `[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]`,
        err
      );

      console.log('[DONE] no SKUs processed');

      return;
    }

    const totalFromApi = queries.length;

    if (config.shortCodeFilter.length > 0) {

      const allow = new Set(config.shortCodeFilter);

      queries =
        queries.filter(q =>
          allow.has(q.shortCode.toUpperCase())
        );

      console.log(
        `[QUEUE] ${queries.length}/${totalFromApi} SKUs match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`
      );

    } else {

      console.log(
        `[QUEUE] ${queries.length} SKUs to scrape`
      );
    }

    for (let i = 0; i < queries.length; i++) {

      const q = queries[i];

      const label =
        `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.sku}"`;

      try {

        const marketplace =
          resolveMarketplace(q.shortCode);

        const product =
          await retry(
            () => scrapeSku(scrapePage, marketplace, q.sku),
            3,
            3000
          );

        console.log(
          `[FILTER] ${label} -> ${product.criticalReviews?.length || 0} critical reviews | ` +
            `delivery: ${product.deliveryPromiseDays ?? 'null'} day(s)`
        );

        await postScrapedResult({
          store_id: q.storeId,

          product_ids: q.productIds,

          rating: toRating(product.rating, product.totalRatings),

          rating_count: toCount(product.totalRatings),

          critical_reviews: {
            reviews: product.criticalReviews ?? []
          },

          // noon has no A+ content module (see README).
          aplus_content: null,

          delivery_promise_days:
            toCount(product.deliveryPromiseDays),

          price: product.price ?? null,
          currency: product.currency,
          availability: product.availability
        });

        console.log(`[OK] ${label} -> sent successfully`);

      } catch (err) {

        console.error(`[FAIL] ${label}`, err);
      }

      if (i < queries.length - 1) {

        const secs =
          Math.round(config.scrapeDelayMs / 1000);

        console.log(
          `[WAIT] sleeping ${secs}s before next SKU...`
        );

        await sleep(config.scrapeDelayMs);
      }
    }

    console.log('[DONE] all SKUs processed');

  } finally {

    await context.close();
  }
}

/** Integer >= 0, else null. */
function toCount(
  value: number | null | undefined
): number | null {

  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

/**
 * 0–5 rounded to 2 decimals, else null. A product with no ratings yet reports
 * 0 — that is "no rating", not a zero-star average, so it goes out as null.
 */
function toRating(
  value: number | null | undefined,
  count: number | null | undefined
): number | null {

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 5 ||
    (value === 0 && !count)
  ) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

main().catch(err => {

  console.error('[FATAL]', err);

  process.exit(1);
});
