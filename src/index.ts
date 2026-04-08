import { openPersistentContext } from './browser';
import { config } from './config';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';
import { scrapeSearchTerm } from './scraper';
import { sleep } from './util';

async function main(): Promise<void> {
  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);

  const context = await openPersistentContext();
  const page = await context.newPage();

  try {
    let settings = loadUserSettings();
    if (!settings) {
      settings = await runFirstLaunchFlow(page);
      // The first-run flow may close the page when the user closes the login tab.
      // Ensure we have a usable page for scraping.
      if (page.isClosed()) {
        // no-op: we'll open a fresh one below
      }
    } else {
      console.log(
        `[BOOT] loaded settings: emailId="${settings.emailId}" profileId="${settings.profileId}"`,
      );
    }

    const scrapePage = page.isClosed() ? await context.newPage() : page;

    const queries = await fetchQueries();
    console.log(`[BOOT] ${queries.length} queries to scrape`);

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const label = `[${i + 1}/${queries.length}] "${q.searchTerm}"`;
      try {
        const products = await scrapeSearchTerm(scrapePage, q.domain, q.searchTerm);
        await postScrapedResult({
          emailId: settings.emailId,
          profileId: settings.profileId,
          queryId: q.id,
          domain: q.domain,
          searchTerm: q.searchTerm,
          scrapedAt: new Date().toISOString(),
          products,
        });
        console.log(`[OK] ${label} -> ${products.length} products`);
      } catch (err) {
        console.error(`[FAIL] ${label}:`, err);
      }

      if (i < queries.length - 1) {
        const secs = Math.round(config.scrapeDelayMs / 1000);
        console.log(`[WAIT] sleeping ${secs}s before next query...`);
        await sleep(config.scrapeDelayMs);
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
