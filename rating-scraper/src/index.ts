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
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';

import { credentialsProblem, serviceAccountId } from './api/auth';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';

import { scrapeAsin } from './scraper';

import { resolveMarketplace } from './marketplaces';

import { sleep } from './util';

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

  // Store ids: SCRAPE_STORE_IDS (set by the VentaWiz agent) wins, else the
  // saved user-settings.json. With env ids the first-run form is never shown.
  const envStoreIds =
    config.envStoreIds;

  const existingSettings =
    loadUserSettings();

  const needsFirstRun =
    envStoreIds.length === 0 &&
    !existingSettings;

  const visible =
    needsFirstRun ||
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
  const credentialsError = credentialsProblem();
  if (credentialsError) {
    console.error(`[FAIL] ${credentialsError}`);
    console.log('[DONE] no ASINs processed (no service-account credentials)');
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

    let storeIds: number[];

    if (envStoreIds.length > 0) {

      storeIds = envStoreIds;

      console.log(
        `[BOOT] store ids from SCRAPE_STORE_IDS: [${storeIds.join(', ')}]`
      );

    } else if (existingSettings) {

      storeIds =
        existingSettings.storeIds;

      console.log(
        `[BOOT] loaded settings: emailId="${existingSettings.emailId}" storeIds=[${storeIds.join(', ')}]`
      );

    } else {

      // The first-run flow may close the page when the user closes the
      // login tab; a fresh one is opened below.
      storeIds =
        (await runFirstLaunchFlow(
          page
        )).storeIds;
    }

    console.log(
      `[BOOT] marketplace: ${config.marketplace}`
    );

    const scrapePage =
      page.isClosed()
        ? await context.newPage()
        : page;

    // The whole queue, once, up front: every store, every page.
    let queries;

    try {

      queries =
        await fetchQueries(
          storeIds
        );

    } catch (err) {

      console.error(
        `[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]`,
        err
      );

      console.log(
        '[DONE] no ASINs processed (queue fetch failed)'
      );

      return;
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
        `[QUEUE] ${queries.length}/${totalFromApi} ASINs match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`
      );

    } else {

      console.log(
        `[QUEUE] ${queries.length} ASINs to scrape`
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
        `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.asin}"`;

      try {

        const marketplace =
          resolveMarketplace(
            q.shortCode
          );

        const product =
          await scrapeAsin(
            scrapePage,
            marketplace.url,
            q.asin
          );

        console.log(
          `[FILTER] ${label} -> ${product.criticalReviews?.length || 0} critical reviews | A+ Content: ${product.aplus_content} | Delivery Promise: ${product.deliveryPromiseDays ?? 'null'} day(s)`
        );

        await postScrapedResult({
          store_id: q.storeId,

          product_ids: q.productIds,

          rating: toRating(
            product.rating
          ),

          // parseIntSafe() returns 0 for "no count found"; a page with no
          // average rating has no readable count either, so 0 is sent as null.
          rating_count:
            toRating(product.rating) === null
              ? null
              : toCount(product.totalRatings),

          critical_reviews: {
            reviews: product.criticalReviews ?? []
          },

          aplus_content:
            product.aplus_content ?? null,

          delivery_promise_days:
            toCount(
              product.deliveryPromiseDays ?? null
            )
        });

        console.log(
          `[OK] ${label} -> sent for product_ids=[${q.productIds.join(', ')}]`
        );

      } catch (err) {

        console.error(
          `[FAIL] ${label}`,
          err
        );
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
          `[WAIT] sleeping ${secs}s before next ASIN...`
        );

        await sleep(
          config.scrapeDelayMs
        );
      }
    }

    console.log(
      '[DONE] all ASINs processed'
    );

  } finally {

    await context.close();
  }
}

/**
 * Average star rating for VentaWiz: 0–5 with at most 2 decimals, else null.
 * Amazon ratings start at 1, so 0 is parseFloatSafe()'s "not found" and is
 * sent as null rather than as a real zero.
 */
function toRating(
  v: number | null | undefined
): number | null {

  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v <= 0 ||
    v > 5
  ) {
    return null;
  }

  return Math.round(v * 100) / 100;
}

/** Whole number >= 0, else null. */
function toCount(
  v: number | null | undefined
): number | null {

  return typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= 0
    ? Math.round(v)
    : null;
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