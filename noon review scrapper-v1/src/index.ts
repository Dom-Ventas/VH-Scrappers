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

  const existingSettings = loadUserSettings();

  const visible =
    !existingSettings ||
    process.env.BROWSER_VISIBLE === '1';

  console.log(
    `[BOOT] browser window: ${visible ? 'visible' : 'off-screen'}`
  );

  const context =
    await openPersistentContext({ visible });

  const page = await context.newPage();

  try {

    let settings = existingSettings;

    if (!settings) {

      settings = await runFirstLaunchFlow(page);

    } else {

      console.log(
        `[BOOT] loaded settings: emailId="${settings.emailId}" profileIds=[${settings.profileIds.join(', ')}]`
      );
    }

    const scrapePage =
      page.isClosed()
        ? await context.newPage()
        : page;

    for (
      let p = 0;
      p < settings.profileIds.length;
      p++
    ) {

      const profileId = settings.profileIds[p];

      console.log(
        `[PROFILE ${p + 1}/${settings.profileIds.length}] fetching SKUs for "${profileId}"`
      );

      let queries;

      try {

        queries = await fetchQueries(profileId);

      } catch (err) {

        console.error(
          `[FAIL] fetchQueries for profileId="${profileId}"`,
          err
        );

        continue;
      }

      const totalFromApi = queries.length;

      if (config.shortCodeFilter.length > 0) {

        const allow = new Set(config.shortCodeFilter);

        queries =
          queries.filter(q =>
            allow.has(q.shortCode.toUpperCase())
          );

        console.log(
          `[PROFILE ${profileId}] ${queries.length}/${totalFromApi} SKUs match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`
        );

      } else {

        console.log(
          `[PROFILE ${profileId}] ${queries.length} SKUs to scrape`
        );
      }

      for (let i = 0; i < queries.length; i++) {

        const q = queries[i];

        const label =
          `[${profileId}] [${i + 1}/${queries.length}] "${q.sku}"`;

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
            emailId: settings.emailId,

            profileId,

            productId: q.productId,

            shortCode: q.shortCode,

            sku: q.sku,

            rating: product.rating,

            ratingCount: product.totalRatings,

            criticalReviews: {
              reviews: product.criticalReviews ?? []
            },

            delivery_promise_days:
              product.deliveryPromiseDays ?? null,
            deliveryPromiseDays:
              product.deliveryPromiseDays ?? null,

            price: product.price ?? null,
            currency: product.currency,
            availability: product.availability
          });

          console.log(`[OK] ${label} -> sent successfully`);

        } catch (err) {

          console.error(`[FAIL] ${label}`, err);
        }

        const isLastQueryOfLastProfile =
          p === settings.profileIds.length - 1 &&
          i === queries.length - 1;

        if (!isLastQueryOfLastProfile) {

          const secs =
            Math.round(config.scrapeDelayMs / 1000);

          console.log(
            `[WAIT] sleeping ${secs}s before next SKU...`
          );

          await sleep(config.scrapeDelayMs);
        }
      }
    }

    console.log('[DONE] all SKUs processed');

  } finally {

    await context.close();
  }
}

main().catch(err => {

  console.error('[FATAL]', err);

  process.exit(1);
});
