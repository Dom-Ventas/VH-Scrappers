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
import {
  runFirstLaunchFlow,
  runLoginAndPincodeFlow
} from './firstRun';

import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';
import { ApiConnectionError } from './api/http';

import { scrapePid } from './scraper';

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

  // Login and the delivery pincode are set by hand and live in the Chrome
  // profile. First run collects them, but they expire and can be cleared, so
  // `--setup` re-runs that step on demand instead of forcing the user to
  // delete user-settings.json to get the prompt back.
  const setupOnly = process.argv.includes('--setup');

  const visible =
    !existingSettings ||
    setupOnly ||
    process.env.BROWSER_VISIBLE === '1';

  console.log(
    `[BOOT] browser window: ${
      visible
        ? 'visible'
        : 'off-screen'
    }`
  );

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

    if (!settings) {

      settings =
        await runFirstLaunchFlow(
          page
        );

    } else {

      console.log(
        `[BOOT] loaded settings: emailId="${settings.emailId}" ` +
          `profileIds=[${settings.profileIds.join(', ')}]`
      );
    }

    const scrapePage =
      page.isClosed()
        ? await context.newPage()
        : page;

    for (
      let p = 0;
      p <
      settings.profileIds.length;
      p++
    ) {

      const profileId =
        settings.profileIds[p];

      console.log(
        `[PROFILE ${p + 1}/${settings.profileIds.length}] fetching PIDs for "${profileId}"`
      );

      let queries;

      try {

        queries =
          await fetchQueries(
            profileId
          );

      } catch (err) {

        // A connection error already explains itself; a stack trace on top of
        // it just buries the instruction.
        if (err instanceof ApiConnectionError) {

          console.error(
            `[FAIL] fetchQueries for profileId="${profileId}"\n\n${err.message}\n`
          );

        } else {

          console.error(
            `[FAIL] fetchQueries for profileId="${profileId}"`,
            err
          );
        }

        continue;
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
          `[PROFILE ${profileId}] ${queries.length}/${totalFromApi} PIDs match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`
        );

      } else {

        console.log(
          `[PROFILE ${profileId}] ${queries.length} PIDs to scrape`
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
          `[${profileId}] [${i + 1}/${queries.length}] "${q.pid}"`;

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
            emailId: settings.emailId,

            profileId,

            productId: q.productId,

            shortCode: q.shortCode,

            pid: q.pid,

            rating: product.rating,

            ratingCount: product.totalRatings,

            criticalReviews: {
              reviews: product.criticalReviews ?? []
            },

            aplus_content: product.aplus_content || "no",

            aplusContent: product.aplusContent || "no",

            delivery_promise_days:
              product.deliveryPromiseDays ?? null,

            deliveryPromiseDays:
              product.deliveryPromiseDays ?? null,

            pincode_applied:
              product.pincodeApplied ?? null,

            pincodeApplied:
              product.pincodeApplied ?? null
          });

          console.log(
            `[OK] ${label} -> sent successfully`
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

        const isLastQueryOfLastProfile =
          p ===
            settings.profileIds.length - 1 &&
          i ===
            queries.length - 1;

        if (
          !isLastQueryOfLastProfile
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
