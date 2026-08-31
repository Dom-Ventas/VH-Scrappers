import { openPersistentContext } from './browser';
import { config } from './config';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';
import { scrapeSearchTerm } from './scraper';
import { resolveMarketplace } from './marketplaces';
import { sleep } from './util';

async function main(): Promise<void> {
  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);

  // Pre-load settings so we can decide whether the browser needs to be
  // visible. First-run requires the user to interact with the form and to
  // sign into Flipkart, so it must be on-screen. Subsequent runs default to
  // off-screen (background) so the user can keep working in other windows.
  // BROWSER_VISIBLE=1 forces visible regardless (useful for debugging).
  const existingSettings = loadUserSettings();
  const visible = !existingSettings || process.env.BROWSER_VISIBLE === '1';
  console.log(`[BOOT] browser window: ${visible ? 'visible' : 'off-screen'}`);

  const context = await openPersistentContext({ visible });
  const page = await context.newPage();

  try {
    let settings = existingSettings;
    if (!settings) {
      settings = await runFirstLaunchFlow(page);
      // The first-run flow may close the page when the user closes the login tab.
      // Ensure we have a usable page for scraping.
      if (page.isClosed()) {
        // no-op: we'll open a fresh one below
      }
    } else {
      console.log(
        `[BOOT] loaded settings: emailId="${settings.emailId}" profileIds=[${settings.profileIds.join(', ')}]`,
      );
    }

    const scrapePage = page.isClosed() ? await context.newPage() : page;

    for (let p = 0; p < settings.profileIds.length; p++) {
      const profileId = settings.profileIds[p];
      console.log(
        `[PROFILE ${p + 1}/${settings.profileIds.length}] fetching queries for "${profileId}"`,
      );

      let queries;
      try {
        queries = await fetchQueries(profileId);
      } catch (err) {
        console.error(`[FAIL] fetchQueries for profileId="${profileId}":`, err);
        continue;
      }
      const totalFromApi = queries.length;
      if (config.shortCodeFilter.length > 0) {
        const allow = new Set(config.shortCodeFilter);
        queries = queries.filter((q) => allow.has(q.shortCode.toUpperCase()));
        console.log(
          `[PROFILE ${profileId}] ${queries.length}/${totalFromApi} queries match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`,
        );
      } else {
        console.log(`[PROFILE ${profileId}] ${queries.length} queries to scrape`);
      }

      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        const label = `[${profileId}] [${i + 1}/${queries.length}] "${q.searchTerm}"`;
        try {
          const { url } = resolveMarketplace(q.shortCode);
          const allProducts = await scrapeSearchTerm(scrapePage, url, q.searchTerm);
          // Backend wants up to 5 sponsored + 5 organic (schema caps at 10). It
          // picks comp1..5 sponsored-first (backfilled with organic) and
          // org1..5, so we send both buckets — not sponsored-only, which left
          // the organic columns NULL and often failed the 5-competitor check.
          const sponsored = allProducts.filter((pr) => pr.isSponsored).slice(0, 5);
          const organic = allProducts.filter((pr) => !pr.isSponsored).slice(0, 5);
          const products = [...sponsored, ...organic];
          console.log(
            `[FILTER] ${label} -> sending ${sponsored.length} sponsored + ${organic.length} organic (of ${allProducts.length} scraped)`,
          );
          await postScrapedResult({
            emailId: settings.emailId,
            profileId,
            queryId: q.id,
            shortCode: q.shortCode,
            searchTerm: q.searchTerm,
            scrapedAt: new Date().toISOString(),
            products,
          });
          console.log(
            `[OK] ${label} -> sent ${products.length} products (${sponsored.length} sponsored + ${organic.length} organic)`,
          );
        } catch (err) {
          console.error(`[FAIL] ${label}:`, err);
        }

        const isLastQueryOfLastProfile =
          p === settings.profileIds.length - 1 && i === queries.length - 1;
        if (!isLastQueryOfLastProfile) {
          const secs = Math.round(config.scrapeDelayMs / 1000);
          console.log(`[WAIT] sleeping ${secs}s before next query...`);
          await sleep(config.scrapeDelayMs);
        }
      }
    }

    console.log('[DONE] all queries processed');
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
