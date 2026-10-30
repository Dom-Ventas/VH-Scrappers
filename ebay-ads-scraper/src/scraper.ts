import { Locator, Page } from 'playwright';
import { config } from './config';
import { Product } from './types';
import { MarketplaceConfig } from './marketplaces';
import { detectSponsored, extractProduct, SELECTORS } from './extractors';
import { sleep } from './util';

export function buildSearchUrl(marketplace: MarketplaceConfig, searchTerm: string): string {
  const cleanDomain = marketplace.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const q = encodeURIComponent(searchTerm.trim());
  return `https://${cleanDomain}/sch/i.html?_nkw=${q}`;
}

/**
 * eBay fronts its site with Akamai Bot Manager. A blocked session gets a
 * "Pardon Our Interruption…" / "Security Measure" page ("Checking your browser
 * before you access eBay", "Please verify yourself to continue") instead of
 * results. Nothing on it matches a result card, so without this check a
 * blocked run would read as "no results" for every term.
 */
export async function isBlockPage(page: Page): Promise<boolean> {
  try {
    if ((await page.locator(SELECTORS.resultCard).count()) > 0) return false;
    const title = await page.title();
    if (/pardon our interruption|security measure|access denied/i.test(title)) return true;
    const body = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    return /pardon our interruption|checking your browser|verify yourself|please verify you are a human|sicherheitsma(?:ß|ss)nahme|entschuldigung für die unterbrechung/i.test(body);
  } catch {
    return false;
  }
}

/** Thrown when eBay served its bot check instead of results for a term. */
export class BlockedError extends Error {
  constructor(searchTerm: string) {
    super(
      `eBay served its bot check ("Pardon Our Interruption") instead of results for "${searchTerm}". ` +
        "Run once with BROWSER_VISIBLE=1, complete the check in the scraper's Chrome profile, " +
        'and retry; raise SCRAPE_DELAY_MS if it keeps happening.',
    );
    this.name = 'BlockedError';
  }
}

/**
 * How long to keep polling a blocked page for results before reloading it
 * once. Akamai sometimes clears a session after its JS challenge runs (and a
 * human can clear it when the window is visible).
 */
const BLOCK_CLEAR_WAIT_MS = 45_000;
const BLOCK_POLL_MS = 3_000;

/** eBay's own "nothing matched" page, which is not an error. */
const NO_RESULTS_RE = /\b0 results for|no exact matches found|keine genauen treffer|0 ergebnisse/i;

/** A one-line picture of a page that did not show results, for the log. */
async function pageState(page: Page): Promise<string> {
  const title = await page.title().catch(() => '?');
  const body = await page
    .locator('body')
    .innerText({ timeout: 2_000 })
    .then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 160))
    .catch(() => '');
  return `title="${title}" url=${page.url()} body="${body}"`;
}

/**
 * Wait for the results list, surviving a transient bot check or a flaky load.
 * Returns true once at least one result card is attached, false when eBay
 * genuinely has no results for the term (a valid "nothing to post" outcome —
 * an empty products list is still stored). Throws BlockedError when the check
 * is still up after the wait and one reload, or a plain Error when the page
 * still shows neither results nor a no-results message after a reload.
 */
async function waitForResults(page: Page, searchTerm: string): Promise<boolean> {
  const cards = page.locator(SELECTORS.resultCard);
  const settled = () =>
    page
      .waitForSelector(SELECTORS.resultCard, { timeout: config.resultsWaitTimeoutMs, state: 'attached' })
      .then(() => true)
      .catch(() => false);

  if (await settled()) return true;

  if (await isBlockPage(page)) {
    const title = await page.title().catch(() => '?');
    console.warn(
      `[BLOCK] "${searchTerm}": eBay served its bot check (title="${title}"); ` +
        `waiting up to ${Math.round(BLOCK_CLEAR_WAIT_MS / 1000)}s for it to clear...`,
    );
    const deadline = Date.now() + BLOCK_CLEAR_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(BLOCK_POLL_MS);
      if ((await cards.count().catch(() => 0)) > 0) {
        console.warn(`[BLOCK] "${searchTerm}": cleared without a reload`);
        return true;
      }
    }
    console.warn(`[BLOCK] "${searchTerm}": still blocked; reloading once`);
  } else {
    const state = await pageState(page);
    if (NO_RESULTS_RE.test(state)) {
      console.warn(`[SCRAPE] "${searchTerm}": eBay shows no results (${state})`);
      return false;
    }
    // Not the bot check and not an empty result: a slow or half-loaded page.
    // Say what was on it, then give it one reload before giving up.
    console.warn(`[SCRAPE] "${searchTerm}": no result cards after ${config.resultsWaitTimeoutMs}ms; ${state}; reloading once`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  if (await settled()) {
    console.warn(`[SCRAPE] "${searchTerm}": results loaded after reload`);
    return true;
  }
  if (await isBlockPage(page)) throw new BlockedError(searchTerm);
  const state = await pageState(page);
  if (NO_RESULTS_RE.test(state)) return false;
  throw new Error(`No search results loaded for "${searchTerm}" after a reload (${state})`);
}

/**
 * How long to wait before re-checking sponsored labels when the first pass
 * found none.
 */
const SPONSORED_RETRY_DELAY_MS = 1_500;

/**
 * Re-run sponsored detection on every card when the first pass found no ads.
 *
 * eBay's ad label is a server-rendered SVG, so a race is unlikely — but an
 * all-organic page is worth one cheap second look, because posting it as-is
 * stores a row with five organic slots and no competitor at all. Costs 1.5 s
 * only on a query that found zero ads.
 *
 * Mutates `products[i].isSponsored` in place and returns how many cards are
 * sponsored after the retry. `detect` is injectable for tests.
 */
export async function retrySponsoredDetection(
  cards: Locator,
  products: Product[],
  searchTerm: string,
  detect: (card: Locator) => Promise<boolean> = detectSponsored,
): Promise<number> {
  if (products.length === 0 || products.some((p) => p.isSponsored)) {
    return products.filter((p) => p.isSponsored).length;
  }

  console.warn(
    `[SPONSORED] "${searchTerm}": 0/${products.length} cards detected as sponsored on first pass; ` +
      `waiting ${SPONSORED_RETRY_DELAY_MS}ms and re-checking`,
  );
  await sleep(SPONSORED_RETRY_DELAY_MS);

  let found = 0;
  for (let i = 0; i < products.length; i++) {
    // Cards that failed extraction have no id; the backend drops them anyway.
    if (!products[i].itemId) continue;
    if (await detect(cards.nth(i))) {
      products[i].isSponsored = true;
      found++;
    }
  }

  if (found > 0) {
    console.warn(`[SPONSORED] "${searchTerm}": retry detected ${found}/${products.length} sponsored`);
  } else {
    console.warn(
      `[SPONSORED] "${searchTerm}": still 0 sponsored after retry — the comp slots will be empty ` +
        'for this row. If the page visibly shows "Sponsored" labels, run ' +
        '`npx tsx scripts/check-sponsored.ts "<term>"` to see which signal moved.',
    );
  }
  return found;
}

export async function scrapeSearchTerm(
  page: Page,
  marketplace: MarketplaceConfig,
  searchTerm: string,
): Promise<Product[]> {
  const url = buildSearchUrl(marketplace, searchTerm);
  console.log(`[SCRAPE] GET ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (!(await waitForResults(page, searchTerm))) return [];

  // eBay server-renders the first 60 cards but lazy-loads images; a few
  // page-downs settle the top rows, and the sponsored check reads the label
  // element's laid-out size, so the cards must have rendered.
  for (let s = 0; s < 3; s++) {
    await page.mouse.wheel(0, 1200);
    await sleep(400);
  }

  const cards = page.locator(SELECTORS.resultCard);
  const total = await cards.count();
  const take = Math.min(total, config.topNResults);

  const products: Product[] = [];
  for (let i = 0; i < take; i++) {
    try {
      const product = await extractProduct(cards.nth(i), i + 1, marketplace);
      products.push(product);
    } catch (err) {
      console.warn(`[SCRAPE] Failed to extract product at position ${i + 1}:`, err);
      products.push({
        position: i + 1,
        itemId: null,
        isSponsored: false,
        title: null,
        price: null,
        rating: null,
        reviewCount: null,
        deliveryText: null,
        deliveryDays: null,
      });
    }
  }

  await retrySponsoredDetection(cards, products, searchTerm);

  // Guard against the classic ad-detector failure, which on eBay is the
  // default one: every card carries a "Sponsored" label element, so a check
  // that does not look at what is actually painted flags all of them. Ads
  // were a third of the top 30 on every verification query.
  if (products.length > 1 && products.every((p) => p.isSponsored)) {
    console.warn(
      `[SCRAPE] SUSPECT: all ${products.length} cards flagged sponsored for "${searchTerm}". ` +
        'eBay may have changed how it hides the decoy label — run `npx tsx scripts/check-sponsored.ts` ' +
        'before trusting this result.',
    );
  }

  return products;
}
