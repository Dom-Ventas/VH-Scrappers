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
import { config } from './config';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';

import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';

import { scrapeAsin } from './scraper';

import { resolveMarketplace } from './marketplaces';

import { sleep } from './util';

async function main() {

  console.log(
    `[BOOT] profile dir: ${config.profileDir}`
  );

  console.log(
    `[BOOT] scrape delay: ${config.scrapeDelayMs}ms`
  );

  const existingSettings =
    loadUserSettings();

  const visible =
    !existingSettings ||
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

    let settings =
      existingSettings;

    if (!settings) {

      settings =
        await runFirstLaunchFlow(
          page
        );

      if (
        page.isClosed()
      ) {
        // same pattern as Ad Scraper
      }

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
      p <
      settings.profileIds.length;
      p++
    ) {

      const profileId =
        settings.profileIds[p];

      console.log(
        `[PROFILE ${p + 1}/${settings.profileIds.length}] fetching ASINs for "${profileId}"`
      );

      let queries;

      try {

        queries =
          await fetchQueries(
            profileId
          );

      } catch (err) {

        console.error(
          `[FAIL] fetchQueries for profileId="${profileId}"`,
          err
        );

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
          `[PROFILE ${profileId}] ${queries.length}/${totalFromApi} ASINs match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`
        );

      } else {

        console.log(
          `[PROFILE ${profileId}] ${queries.length} ASINs to scrape`
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
          `[${profileId}] [${i + 1}/${queries.length}] "${q.asin}"`;

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
            `[FILTER] ${label} -> ${product.criticalReviews?.length || 0} critical reviews`
          );

          await postScrapedResult({
            emailId: settings.emailId,

            profileId,

            productId: q.productId,

            shortCode: q.shortCode,

            asin: q.asin,

            rating: product.rating,

            ratingCount: product.totalRatings,

            criticalReviews: {
    reviews: product.criticalReviews ?? []
}
});

          console.log(
            `[OK] ${label} -> sent successfully`
          );

        } catch (err) {

          console.error(
            `[FAIL] ${label}`,
            err
          );
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
            `[WAIT] sleeping ${secs}s before next ASIN...`
          );

          await sleep(
            config.scrapeDelayMs
          );
        }
      }
    }

    console.log(
      '[DONE] all ASINs processed'
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