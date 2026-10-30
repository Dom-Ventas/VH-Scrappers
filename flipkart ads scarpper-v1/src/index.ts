import { openPersistentContext } from './browser';
import { config } from './config';
import { loadUserSettings, resolveStoreIds } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { credentialsProblem, serviceAccountId } from './api/auth';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';
import { scrapeSearchTerm } from './scraper';
import { resolveMarketplace } from './marketplaces';
import { sleep } from './util';
import { Product, Query, ResultProduct } from './types';

/** A number in [min, max], else null — the backend rejects out-of-range values. */
function inRange(n: number | null, min: number, max: number): number | null {
  return n !== null && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * Convert a scraped card to the shape the results endpoint takes. Flipkart's
 * results page shows no delivery promise, so `delivery_days` is always null.
 */
function toResultProduct(pr: Product): ResultProduct {
  const reviewCount = inRange(pr.reviewCount, 0, Number.MAX_SAFE_INTEGER);
  return {
    position: pr.position,
    mp_product_id: pr.asin as string,
    is_sponsored: pr.isSponsored,
    price: pr.price || null,
    rating: inRange(pr.rating, 0, 5),
    review_count: reviewCount === null ? null : Math.round(reviewCount),
    delivery_days: null,
    title: pr.title,
  };
}

async function main(): Promise<void> {
  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);
  console.log(`[BOOT] marketplace: ${config.marketplace}`);

  // Pre-load settings so we can decide whether the browser needs to be
  // visible. First-run requires the user to interact with the form and to
  // sign into Flipkart, so it must be on-screen. Subsequent runs default to
  // off-screen (background) so the user can keep working in other windows.
  // BROWSER_VISIBLE=1 forces visible regardless (useful for debugging).
  //
  // When the agent passes SCRAPE_STORE_IDS the store ids are already known,
  // so the first-run form is never shown, even with no settings file.
  const existingSettings = loadUserSettings();
  const envStoreIds = resolveStoreIds(null);
  const needsFirstRun = !existingSettings && envStoreIds.length === 0;
  const visible = needsFirstRun || process.env.BROWSER_VISIBLE === '1';
  console.log(`[BOOT] browser window: ${visible ? 'visible' : 'off-screen'}`);

  // No service account → nothing can be fetched or posted. Fail before
  // opening Chrome, keeping the [FAIL]/[DONE] markers the agent counts.
  const credentialsError = credentialsProblem();
  if (credentialsError) {
    console.error(`[FAIL] ${credentialsError}`);
    console.log('[DONE] no queries processed (no service-account credentials)');
    return;
  }
  console.log(`[BOOT] service account: ${serviceAccountId()} via ${config.authRoot}`);

  const context = await openPersistentContext({ visible });
  const page = await context.newPage();

  try {
    let settings = existingSettings;
    if (needsFirstRun) {
      settings = await runFirstLaunchFlow(page);
      // The first-run flow may close the page when the user closes the login tab.
      // Ensure we have a usable page for scraping.
      if (page.isClosed()) {
        // no-op: we'll open a fresh one below
      }
    } else if (settings) {
      console.log(
        `[BOOT] loaded settings: emailId="${settings.emailId}" storeIds=[${settings.storeIds.join(', ')}]`,
      );
    }

    const storeIds = resolveStoreIds(settings);
    console.log(
      `[BOOT] store ids (${config.storeIdsEnv ? 'SCRAPE_STORE_IDS' : 'user-settings.json'}): [${storeIds.join(', ')}]`,
    );

    const scrapePage = page.isClosed() ? await context.newPage() : page;

    let queries: Query[];
    try {
      queries = await fetchQueries(storeIds);
    } catch (err) {
      console.error(`[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]:`, err);
      queries = [];
    }
    const totalFromApi = queries.length;
    if (config.shortCodeFilter.length > 0) {
      const allow = new Set(config.shortCodeFilter);
      queries = queries.filter((q) => allow.has(q.shortCode.toUpperCase()));
      console.log(
        `[QUEUE] ${queries.length}/${totalFromApi} search terms match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`,
      );
    } else {
      console.log(`[QUEUE] ${queries.length} search terms to scrape`);
    }

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const label = `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.searchTerm}"`;
      try {
        const { url } = resolveMarketplace(q.shortCode);
        const allProducts = await scrapeSearchTerm(scrapePage, url, q.searchTerm);
        // Backend keeps up to 5 sponsored (comp1..5) and 5 organic (org1..5),
        // never mixing the two, so both buckets are sent in page order. Cards
        // with no PID are placeholders the backend would drop anyway.
        const withId = allProducts.filter((pr) => pr.asin);
        const sponsored = withId.filter((pr) => pr.isSponsored).slice(0, 5);
        const organic = withId.filter((pr) => !pr.isSponsored).slice(0, 5);
        const products = [...sponsored, ...organic]
          .sort((a, b) => a.position - b.position)
          .map(toResultProduct);
        console.log(
          `[FILTER] ${label} -> sending ${sponsored.length} sponsored + ${organic.length} organic (of ${allProducts.length} scraped)`,
        );
        // An empty `products` is still posted: "no results today" is a result,
        // and storing it is what takes the term off today's queue.
        const outcome = await postScrapedResult({
          store_id: q.storeId,
          search_term: q.searchTerm,
          products,
        });
        if (outcome.status === 'already-stored') {
          console.log(`[OK] ${label} (already stored today)`);
        } else {
          console.log(
            `[OK] ${label} -> stored ${outcome.sponsored} sponsored + ${outcome.organic} organic (sent ${products.length})`,
          );
        }
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
