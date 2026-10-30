import { openPersistentContext } from './browser';
import { config } from './config';
import { credentialsProblem, serviceAccountId } from './api/auth';
import { loadUserSettings } from './userSettings';
import { runFirstLaunchFlow } from './firstRun';
import { fetchQueries } from './api/queries';
import { postScrapedResult, toResultProducts } from './api/results';
import { BlockedError, scrapeSearchTerm } from './scraper';
import { resolveMarketplace } from './marketplaces';
import { sleep } from './util';

/** Extra pause before the next term after one was blocked. */
const BLOCK_BACKOFF_MS = 60_000;
/** Give up on the cycle after this many blocked terms in a row. */
const MAX_CONSECUTIVE_BLOCKS = 3;

async function main(): Promise<void> {
  console.log(`[BOOT] profile dir: ${config.profileDir}`);
  console.log(`[BOOT] scrape delay: ${config.scrapeDelayMs}ms`);

  // No service account → nothing can be fetched or posted. Fail before
  // opening Chrome, keeping the [FAIL]/[DONE] markers the agent counts.
  const credentialsError = credentialsProblem();
  if (credentialsError) {
    console.error(`[FAIL] ${credentialsError}`);
    console.log('[DONE] no queries processed (no service-account credentials)');
    return;
  }
  console.log(`[BOOT] service account: ${serviceAccountId()} via ${config.authRoot}`);


  // Store ids come from the agent (SCRAPE_STORE_IDS) when it launched us, else
  // from user-settings.json. Only a standalone run with neither needs the
  // first-run form — which also needs the user to set eBay's "Shipping to"
  // location (and pass a bot check if one appears), so it must be on-screen.
  // Other runs default to off-screen (background) so the user can keep working
  // in other windows. BROWSER_VISIBLE=1 forces visible regardless (useful for
  // debugging).
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
      // The first-run flow may close the page when the user closes the eBay
      // tab; a fresh one is opened below.
      storeIds = (await runFirstLaunchFlow(page)).storeIds;
    }

    const scrapePage = page.isClosed() ? await context.newPage() : page;

    console.log(
      `[QUEUE] fetching search terms for ${storeIds.length} store(s), marketplace=${config.marketplace}`,
    );
    let queries;
    try {
      queries = await fetchQueries(storeIds);
    } catch (err) {
      console.error(`[FAIL] fetchQueries for storeIds=[${storeIds.join(', ')}]:`, err);
      console.log('[DONE] no queries processed');
      return;
    }

    const totalFromApi = queries.length;
    if (config.shortCodeFilter.length > 0) {
      const allow = new Set(config.shortCodeFilter);
      const seen = [...new Set(queries.map((q) => q.shortCode.toUpperCase()))];
      queries = queries.filter((q) => allow.has(q.shortCode.toUpperCase()));
      console.log(
        `[QUEUE] ${queries.length}/${totalFromApi} queries match SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}]`,
      );
      // A filter that drops EVERY query is almost always a config mismatch,
      // not an intentional no-op — and it is otherwise invisible, because the
      // run goes on to finish cleanly and report success having scraped
      // nothing. Name both sides so the mismatch is obvious at a glance.
      if (totalFromApi > 0 && queries.length === 0) {
        console.error(
          `[QUEUE] SHORT CODE MISMATCH: SCRAPE_SHORT_CODES=[${config.shortCodeFilter.join(',')}] ` +
            `matched none of the ${totalFromApi} queries the API returned (their codes: [${seen.join(', ')}]). ` +
            'Nothing will be scraped. Check SCRAPE_SHORT_CODES against the backend ' +
            'marketplace table and the MARKETPLACES map in src/marketplaces.ts.',
        );
      }
    } else {
      console.log(`[QUEUE] ${queries.length} queries to scrape`);
    }

    // eBay's bot check is per session: once it starts, every further page
    // load while it is up digs the profile in deeper. After a blocked term the
    // next one waits an extra BLOCK_BACKOFF_MS, and after MAX_CONSECUTIVE_BLOCKS
    // in a row the rest of the queue is left for the next cycle (the terms stay
    // due in the queue — nothing was stored for them).
    let consecutiveBlocks = 0;
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const label = `[store ${q.storeId}] [${i + 1}/${queries.length}] "${q.searchTerm}"`;
      try {
        const marketplace = resolveMarketplace(q.shortCode);
        const allProducts = await scrapeSearchTerm(scrapePage, marketplace, q.searchTerm);
        // Backend keeps up to 5 sponsored (comp1..5) + 5 organic (org1..5) and
        // never mixes them, so send both buckets in page order. Cards with no
        // item number are dropped; an empty list is still posted ("no ads today").
        const products = toResultProducts(allProducts);
        const sponsored = products.filter((pr) => pr.is_sponsored).length;
        const organic = products.length - sponsored;
        console.log(
          `[FILTER] ${label} -> sending ${sponsored} sponsored + ${organic} organic (of ${allProducts.length} scraped)`,
        );
        const outcome = await postScrapedResult({
          store_id: q.storeId,
          search_term: q.searchTerm,
          products,
        });
        if (outcome.alreadyStored) {
          console.log(`[OK] ${label} (already stored today)`);
        } else {
          const s = outcome.stored;
          console.log(
            `[OK] ${label} -> stored ${s?.sponsored ?? sponsored} sponsored + ${s?.organic ?? organic} organic` +
              (s?.id != null ? ` (id ${s.id})` : ''),
          );
        }
        consecutiveBlocks = 0;
      } catch (err) {
        console.error(`[FAIL] ${label}:`, err);
        if (err instanceof BlockedError) {
          consecutiveBlocks++;
          if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
            const left = queries.length - i - 1;
            console.error(
              `[BLOCK] ${consecutiveBlocks} consecutive terms blocked by eBay's bot check — ` +
                `leaving the remaining ${left} quer${left === 1 ? 'y' : 'ies'} for the next cycle. ` +
                'Run once with BROWSER_VISIBLE=1 to clear the check in this Chrome profile.',
            );
            break;
          }
        }
      }

      if (i < queries.length - 1) {
        const extra = consecutiveBlocks > 0 ? BLOCK_BACKOFF_MS : 0;
        const secs = Math.round((config.scrapeDelayMs + extra) / 1000);
        console.log(`[WAIT] sleeping ${secs}s before next query...${extra ? ' (backing off after a block)' : ''}`);
        await sleep(config.scrapeDelayMs + extra);
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
