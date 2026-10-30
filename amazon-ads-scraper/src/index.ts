import { openPersistentContext } from './browser';
import { config } from './config';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { credentialsProblem, serviceAccountId } from './api/auth';
import { fetchQueries } from './api/queries';
import { postScrapedResult } from './api/results';
import { scrapeSearchTerm } from './scraper';
import { resolveMarketplace } from './marketplaces';
import { sleep } from './util';
import { Product, ResultProduct } from './types';

async function main(): Promise<void> {
  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);

  // Store ids: SCRAPE_STORE_IDS (set by the VentaWiz agent) wins, else the
  // saved user-settings.json. With env ids the first-run form is never shown.
  //
  // Pre-load settings so we can decide whether the browser needs to be
  // visible. First-run requires the user to interact with the form and to
  // sign into Amazon, so it must be on-screen. Subsequent runs default to
  // off-screen (background) so the user can keep working in other windows.
  // BROWSER_VISIBLE=1 forces visible regardless (useful for debugging).
  const envStoreIds = config.envStoreIds;
  const existingSettings = loadUserSettings();
  const needsFirstRun = envStoreIds.length === 0 && !existingSettings;
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
    let storeIds: number[];
    if (envStoreIds.length > 0) {
      storeIds = envStoreIds;
      console.log(`[BOOT] store ids from SCRAPE_STORE_IDS: [${storeIds.join(', ')}]`);
    } else if (existingSettings) {
      storeIds = existingSettings.storeIds;
      console.log(
        `[BOOT] loaded settings: emailId="${existingSettings.emailId}" storeIds=[${storeIds.join(', ')}]`,
      );
    } else {
      // The first-run flow may close the page when the user closes the login
      // tab; a fresh one is opened below.
      storeIds = (await runFirstLaunchFlow(page)).storeIds;
    }
    console.log(`[BOOT] marketplace: ${config.marketplace}`);

    const scrapePage = page.isClosed() ? await context.newPage() : page;

    // The whole queue, once, up front: every store, every page.
    let queries;
    try {
      queries = await fetchQueries(storeIds);
    } catch (err) {
      console.error(`[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]:`, err);
      console.log('[DONE] no queries processed (queue fetch failed)');
      return;
    }
    const totalFromApi = queries.length;
    if (config.shortCodeFilter.length > 0) {
      const allow = new Set(config.shortCodeFilter);
      queries = queries.filter((q) => allow.has(q.shortCode.toUpperCase()));
      console.log(
        `[QUEUE] ${queries.length}/${totalFromApi} queries match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`,
      );
    } else {
      console.log(`[QUEUE] ${queries.length} queries to scrape`);
    }

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const label = `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.searchTerm}"`;
      try {
        const { url } = resolveMarketplace(q.shortCode);
        const allProducts = await scrapeSearchTerm(scrapePage, url, q.searchTerm);
        // Up to 5 sponsored + 5 organic, never mixed: the backend stores
        // sponsored in comp1..5 and organic in org1..5, and leaves a short
        // bucket's slots NULL rather than backfilling.
        // Strictly the first N of each bucket in page order — no
        // substitution. A product with genuinely no ratings (Amazon shows
        // none to scrape) is still the real placement, so it is sent with
        // null fields rather than skipped in favour of a lower product.
        // A card with no ASIN is a placeholder the scraper couldn't read; the
        // backend would drop it, so it must not use up a slot.
        const readable = allProducts.filter((pr) => pr.asin);
        const sponsored = readable
          .filter((pr) => pr.isSponsored)
          .slice(0, config.productsPerBucket);
        const organic = readable
          .filter((pr) => !pr.isSponsored)
          .slice(0, config.productsPerBucket);
        const products = [...sponsored, ...organic];
        console.log(
          `[FILTER] ${label} -> sending ${sponsored.length} sponsored + ${organic.length} organic (of ${allProducts.length} scraped)`,
        );
        // An empty list is still posted: "no ads today" is a result.
        const outcome = await postScrapedResult({
          store_id: q.storeId,
          search_term: q.searchTerm,
          products: products.map(toResultProduct),
        });
        if (outcome.alreadyStored) {
          console.log(`[OK] ${label} -> already stored today`);
        } else {
          console.log(
            `[OK] ${label} -> sent ${products.length} products; stored ${outcome.sponsored ?? '?'} sponsored + ${outcome.organic ?? '?'} organic`,
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

/** Integer >= 0, else null — the backend rejects negatives and wants null, not 0 / -1, for "unknown". */
function nonNegativeInt(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/** Internal card -> VentaWiz wire shape (snake_case, ASIN as mp_product_id). */
function toResultProduct(p: Product): ResultProduct {
  return {
    position: p.position,
    mp_product_id: p.asin as string,
    is_sponsored: p.isSponsored,
    price: p.price,
    rating:
      typeof p.rating === 'number' && Number.isFinite(p.rating) && p.rating >= 0 && p.rating <= 5
        ? p.rating
        : null,
    review_count: nonNegativeInt(p.reviewCount),
    delivery_days: nonNegativeInt(p.deliveryDays),
    title: p.title,
  };
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
