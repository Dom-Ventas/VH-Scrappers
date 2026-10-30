import * as path from 'path';

// ─── EXE CWD BOOTSTRAP ────────────────────────────────────────────────────────
// When packaged with pkg/nexe the process starts with CWD = C:\Windows\System32
// or wherever the user launched from. Playwright uses dynamic require() to load
// browsers.json and other runtime files from node_modules on disk.
// Setting CWD to the directory that contains the exe makes all relative
// require() calls (and dotenv) resolve correctly.
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
import {
  loadUserSettings,
  resolveStoreIds
} from './userSettings';
import {
  runFirstLaunchFlow,
  runLoginAndPincodeFlow
} from './firstRun';

import { credentialsProblem, serviceAccountId } from './api/auth';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';
import { ApiConnectionError } from './api/http';

import { scrapePid } from './scraper';

import { resolveMarketplace } from './marketplaces';

import { sleep } from './util';

import { Query } from './types';

/**
 * Average star rating as the backend takes it: 0–5 with at most two decimals.
 * Flipkart's lowest star is 1, so 0 means the page shows no average — null.
 */
function toRating(
  value: number | null | undefined
): number | null {

  if (
    value == null ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 5
  ) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

/** A whole number >= 0, else null — never 0 or -1 standing in for "unknown". */
function toCount(
  value: number | null | undefined
): number | null {

  return value != null &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.round(value)
    : null;
}

async function main() {

  console.log(
    `[BOOT] env file(s): ${
      envFilesLoaded.length
        ? envFilesLoaded.join(', ')
        : 'none found — using built-in defaults'
    }`
  );

  console.log(
    `[BOOT] profile dir: ${config.profileDir}`
  );

  console.log(
    `[BOOT] scrape delay: ${config.scrapeDelayMs}ms`
  );

  console.log(
    `[BOOT] review crawl: max ${config.maxReviewPages} page(s), ` +
      `max ${config.maxCriticalReviews} critical review(s) per product`
  );

  console.log(
    `[BOOT] queries: ${
      config.queriesApiUrl || 'LOCAL queries.json (no API configured)'
    }`
  );

  console.log(
    `[BOOT] results: ${
      config.resultsApiUrl || 'LOCAL results/*.jsonl (no API configured)'
    }`
  );

  const existingSettings =
    loadUserSettings();

  // When the agent passes SCRAPE_STORE_IDS the store ids are already known, so
  // the first-run form is never needed, even with no settings file.
  const envStoreIds =
    resolveStoreIds(null);

  const needsFirstRun =
    !existingSettings &&
    envStoreIds.length === 0;

  // Login and the delivery pincode are set by hand and live in the Chrome
  // profile. First run collects them, but they expire and can be cleared, so
  // `--setup` re-runs that step on demand instead of forcing the user to
  // delete user-settings.json to get the prompt back.
  const setupOnly = process.argv.includes('--setup');

  const visible =
    needsFirstRun ||
    setupOnly ||
    process.env.BROWSER_VISIBLE === '1';

  console.log(
    `[BOOT] browser window: ${
      visible
        ? 'visible'
        : 'off-screen'
    }`
  );

  // No service account → nothing can be fetched or posted. Fail before
  // opening Chrome, keeping the [FAIL]/[DONE] markers the agent counts.
  // `--setup` and LOCAL mode (no API URLs) never talk to VentaWiz.
  const credentialsError =
    !setupOnly && (config.queriesApiUrl || config.resultsApiUrl)
      ? credentialsProblem()
      : null;
  if (credentialsError) {
    console.error(`[FAIL] ${credentialsError}`);
    console.log('[DONE] no PIDs processed (no service-account credentials)');
    return;
  }
  console.log(`[BOOT] service account: ${serviceAccountId()} via ${config.authRoot}`);

  const context =
    await openPersistentContext({
      visible
    });

  const page =
    await context.newPage();

  try {

    if (setupOnly) {

      if (!existingSettings) {
        console.log(
          '[SETUP] No settings yet — run the scraper once to create them, ' +
            'then use --setup to redo the Flipkart login/pincode step.'
        );
        return;
      }

      await runLoginAndPincodeFlow(context);

      return;
    }

    let settings =
      existingSettings;

    if (needsFirstRun) {

      settings =
        await runFirstLaunchFlow(
          page
        );

    } else if (settings) {

      console.log(
        `[BOOT] loaded settings: emailId="${settings.emailId}" ` +
          `storeIds=[${settings.storeIds.join(', ')}]`
      );
    }

    const storeIds =
      resolveStoreIds(settings);

    console.log(
      `[BOOT] store ids (${
        config.storeIdsEnv
          ? 'SCRAPE_STORE_IDS'
          : 'user-settings.json'
      }): [${storeIds.join(', ')}] marketplace=${config.marketplace}`
    );

    const scrapePage =
      page.isClosed()
        ? await context.newPage()
        : page;

    // The whole queue is fetched once, for every store, before any scraping.
    let queries: Query[];

    try {

      queries =
        await fetchQueries(
          storeIds
        );

    } catch (err) {

      // A connection error already explains itself; a stack trace on top of
      // it just buries the instruction.
      if (err instanceof ApiConnectionError) {

        console.error(
          `[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]\n\n${err.message}\n`
        );

      } else {

        console.error(
          `[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]`,
          err
        );
      }

      queries = [];
    }

    const totalFromApi =
      queries.length;

    if (
      config.shortCodeFilter
        .length > 0
    ) {

      const allow =
        new Set(
          config.shortCodeFilter
        );

      queries =
        queries.filter(
          q =>
            allow.has(
              q.shortCode.toUpperCase()
            )
        );

      console.log(
        `[QUEUE] ${queries.length}/${totalFromApi} PIDs match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`
      );

    } else {

      console.log(
        `[QUEUE] ${queries.length} PIDs to scrape`
      );
    }

    for (
      let i = 0;
      i < queries.length;
      i++
    ) {

      const q =
        queries[i];

      const label =
        `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.pid}"`;

      try {

        const marketplace =
          resolveMarketplace(
            q.shortCode
          );

        const product =
          await scrapePid(
            scrapePage,
            marketplace.url,
            q.pid
          );

        console.log(
          `[FILTER] ${label} -> ${product.criticalReviews?.length || 0} critical reviews | A+ Content: ${product.aplus_content} | Delivery Promise: ${product.deliveryPromiseDays ?? 'null'} day(s)`
        );

        await postScrapedResult({
          store_id: q.storeId,

          product_ids: q.productIds,

          rating:
            toRating(product.rating),

          rating_count:
            toCount(product.totalRatings),

          critical_reviews: {
            reviews: product.criticalReviews ?? []
          },

          aplus_content:
            product.aplus_content ?? null,

          delivery_promise_days:
            toCount(product.deliveryPromiseDays),

          pincode_applied:
            product.pincodeApplied ?? null
        });

        console.log(
          `[OK] ${label} -> sent successfully (product_ids=[${q.productIds.join(', ')}])`
        );

      } catch (err) {

        if (err instanceof ApiConnectionError) {

          console.error(
            `[FAIL] ${label} — scraped OK but could not be sent\n\n${err.message}\n`
          );

        } else {

          console.error(
            `[FAIL] ${label}`,
            err
          );
        }
      }

      if (
        i < queries.length - 1
      ) {

        const secs =
          Math.round(
            config.scrapeDelayMs /
              1000
          );

        console.log(
          `[WAIT] sleeping ${secs}s before next PID...`
        );

        await sleep(
          config.scrapeDelayMs
        );
      }
    }

    console.log(
      '[DONE] all PIDs processed'
    );

  } finally {

    await context.close();
  }
}

main().catch(
  err => {

    console.error(
      '[FATAL]',
      err
    );

    process.exit(1);
  }
);
