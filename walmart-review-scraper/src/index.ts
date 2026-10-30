import { openPersistentContext } from './browser';
import { config } from './config';
import { credentialsProblem, serviceAccountId } from './api/auth';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { fetchQueries } from './api/queries';
import { postScrapedResult, toScrapedResult } from './api/results';
import { BlockedError, scrapeProduct } from './scraper';
import { resolveMarketplace } from './marketplaces';
import { retry, sleep } from './util';

/** Extra pause before the next product after one was blocked. */
const BLOCK_BACKOFF_MS = 60_000;
/** Give up on the cycle after this many blocked products in a row. */
const MAX_CONSECUTIVE_BLOCKS = 3;

async function main(): Promise<void> {
  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);

  // No service account → nothing can be fetched or posted. Fail before
  // opening Chrome, keeping the [FAIL]/[DONE] markers the agent counts.
  const credentialsError = credentialsProblem();
  if (credentialsError) {
    console.error(`[FAIL] ${credentialsError}`);
    console.log('[DONE] no products processed (no service-account credentials)');
    return;
  }
  console.log(`[BOOT] service account: ${serviceAccountId()} via ${config.authRoot}`);

  console.log(`[BOOT] max critical reviews per product: ${config.maxCriticalReviews}`);

  // Store ids come from the agent (SCRAPE_STORE_IDS) when it launched us, else
  // from user-settings.json. Only a standalone run with neither needs the
  // first-run form, which must be on-screen.
  const existingSettings = loadUserSettings();
  const needsFirstRun = config.envStoreIds.length === 0 && !existingSettings;
  const visible = needsFirstRun || process.env.BROWSER_VISIBLE === '1';
  console.log(`[BOOT] browser window: ${visible ? 'visible' : 'off-screen'}`);

  const context = await openPersistentContext({ visible });
  const page = await context.newPage();

  try {
    let storeIds: number[];
    if (config.envStoreIds.length > 0) {
      storeIds = config.envStoreIds;
      console.log(`[BOOT] store ids from SCRAPE_STORE_IDS: [${storeIds.join(', ')}]`);
    } else if (existingSettings) {
      storeIds = existingSettings.storeIds;
      console.log(
        `[BOOT] loaded settings: emailId="${existingSettings.emailId}" storeIds=[${storeIds.join(', ')}]`,
      );
    } else {
      storeIds = (await runFirstLaunchFlow(page)).storeIds;
    }

    const scrapePage = page.isClosed() ? await context.newPage() : page;

    console.log(
      `[QUEUE] fetching products for ${storeIds.length} store(s), marketplace=${config.marketplace}`,
    );
    let queries;
    try {
      queries = await fetchQueries(storeIds);
    } catch (err) {
      console.error(`[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]:`, err);
      console.log('[DONE] no products processed');
      return;
    }

    const totalFromApi = queries.length;
    if (config.shortCodeFilter.length > 0) {
      const allow = new Set(config.shortCodeFilter);
      const seen = [...new Set(queries.map((q) => q.shortCode.toUpperCase()))];
      queries = queries.filter((q) => allow.has(q.shortCode.toUpperCase()));
      console.log(
        `[QUEUE] ${queries.length}/${totalFromApi} products match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`,
      );
      if (totalFromApi > 0 && queries.length === 0) {
        console.error(
          `[QUEUE] SHORT CODE MISMATCH: SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}] ` +
            `matched none of the ${totalFromApi} products the API returned (their codes: [${seen.join(', ')}]). ` +
            'Nothing will be scraped. Check SCRAPE_SHORT_CODES against the backend ' +
            'marketplace table and the MARKETPLACES map in src/marketplaces.ts.',
        );
      }
    } else {
      console.log(`[QUEUE] ${queries.length} products to scrape`);
    }

    // Walmart's bot check is per session: after a blocked product the next one
    // waits an extra BLOCK_BACKOFF_MS, and after MAX_CONSECUTIVE_BLOCKS in a
    // row the rest of the queue is left for the next cycle (nothing was
    // stored for them, so they stay due).
    let consecutiveBlocks = 0;
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const label = `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.wpid}"`;
      try {
        const marketplace = resolveMarketplace(q.shortCode);
        const product = await retry(() => scrapeProduct(scrapePage, marketplace, q.wpid), 3, 3_000);
        const body = toScrapedResult(q, product);
        console.log(
          `[FILTER] ${label} -> rating ${body.rating ?? 'null'} (${body.rating_count ?? 'null'} ratings), ` +
            `${product.criticalReviews.length} critical reviews, delivery ${body.delivery_promise_days ?? 'null'} day(s)`,
        );
        await postScrapedResult(body);
        console.log(`[OK] ${label} -> stored for product_ids=[${q.productIds.join(', ')}]`);
        consecutiveBlocks = 0;
      } catch (err) {
        console.error(`[FAIL] ${label}:`, err);
        if (err instanceof BlockedError) {
          consecutiveBlocks++;
          if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
            const left = queries.length - i - 1;
            console.error(
              `[BLOCK] ${consecutiveBlocks} consecutive products blocked by Walmart's bot check — ` +
                `leaving the remaining ${left} product${left === 1 ? '' : 's'} for the next cycle. ` +
                'Run once with BROWSER_VISIBLE=1 to clear the check in this Chrome profile.',
            );
            break;
          }
        }
      }

      if (i < queries.length - 1) {
        const extra = consecutiveBlocks > 0 ? BLOCK_BACKOFF_MS : 0;
        const secs = Math.round((config.scrapeDelayMs + extra) / 1000);
        console.log(`[WAIT] sleeping ${secs}s before next product...${extra ? ' (backing off after a block)' : ''}`);
        await sleep(config.scrapeDelayMs + extra);
      }
    }

    console.log('[DONE] all products processed');
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
