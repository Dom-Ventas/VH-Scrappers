import { Locator, Page } from 'playwright';
import { config } from './config';
import { Product } from './types';
import { MarketplaceConfig } from './marketplaces';
import { detectSponsored, extractProduct, SELECTORS } from './extractors';
import { sleep } from './util';

export function buildSearchUrl(marketplace: MarketplaceConfig, searchTerm: string): string {
  const cleanDomain = marketplace.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const q = encodeURIComponent(searchTerm.trim());
  return `https://${cleanDomain}/search?q=${q}`;
}

/**
 * Walmart fronts its site with a bot check (PerimeterX): a page titled "Robot
 * or human?" with a press-and-hold widget, served instead of the results when
 * a session looks automated. Nothing on it matches a product selector, so
 * without this check a blocked run would read as "no results" for every term.
 *
 * Only the page TITLE and the challenge wording are trusted. The `#px-captcha`
 * container is NOT a signal: PerimeterX mounts it (hidden) on ordinary results
 * pages too — seen on a page showing 46 product tiles — so matching on it
 * would call a healthy page blocked.
 */
export async function isBlockPage(page: Page): Promise<boolean> {
  try {
    if ((await page.locator(SELECTORS.resultCard).count()) > 0) return false;
    const title = await page.title();
    if (/robot or human/i.test(title)) return true;
    const body = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    return /robot or human|press\s*(?:&|and)\s*hold|activate and hold the button/i.test(body);
  } catch {
    return false;
  }
}

/** Thrown when Walmart served its bot check instead of results for a term. */
export class BlockedError extends Error {
  constructor(searchTerm: string) {
    super(
      `Walmart served its "Robot or human?" check instead of results for "${searchTerm}". ` +
        'Run once with BROWSER_VISIBLE=1, complete the press-and-hold check in the scraper\'s ' +
        'Chrome profile, and retry; raise SCRAPE_DELAY_MS if it keeps happening.',
    );
    this.name = 'BlockedError';
  }
}

/**
 * How long to keep polling a blocked page for results before reloading it
 * once. PerimeterX sometimes clears a session after a silent JS challenge
 * (and a human can clear it when the window is visible), so a blocked term is
 * given this long to come good before it is given up.
 */
const BLOCK_CLEAR_WAIT_MS = 45_000;
const BLOCK_POLL_MS = 3_000;

/** Walmart's own "nothing matched" page, which is not an error. */
const NO_RESULTS_RE = /no (?:search )?results for|did(?:n't| not) match any|we couldn't find any/i;

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
 * Wait for the results grid, surviving a transient bot check or a flaky load.
 * Returns normally once at least one result card is attached; throws
 * BlockedError when the check is still up after the wait and one reload, or a
 * plain Error when the page genuinely has no results (or still shows none
 * after a reload — the message carries the page state for the log).
 */
async function waitForResults(page: Page, searchTerm: string): Promise<void> {
  const cards = page.locator(SELECTORS.resultCard);
  const settled = () =>
    page
      .waitForSelector(SELECTORS.resultCard, { timeout: config.resultsWaitTimeoutMs })
      .then(() => true)
      .catch(() => false);

  if (await settled()) return;

  if (await isBlockPage(page)) {
    const title = await page.title().catch(() => '?');
    console.warn(
      `[BLOCK] "${searchTerm}": Walmart served its bot check (title="${title}"); ` +
        `waiting up to ${Math.round(BLOCK_CLEAR_WAIT_MS / 1000)}s for it to clear...`,
    );
    const deadline = Date.now() + BLOCK_CLEAR_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(BLOCK_POLL_MS);
      if ((await cards.count().catch(() => 0)) > 0) {
        console.warn(`[BLOCK] "${searchTerm}": cleared without a reload`);
        return;
      }
    }
    console.warn(`[BLOCK] "${searchTerm}": still blocked; reloading once`);
  } else {
    const state = await pageState(page);
    if (NO_RESULTS_RE.test(state)) {
      throw new Error(`Walmart shows no results for "${searchTerm}" (${state})`);
    }
    // Not the bot check and not an empty result: a slow or half-loaded page.
    // Say what was on it, then give it one reload before giving up.
    console.warn(`[SCRAPE] "${searchTerm}": no result cards after ${config.resultsWaitTimeoutMs}ms; ${state}; reloading once`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  if (await settled()) {
    console.warn(`[SCRAPE] "${searchTerm}": results loaded after reload`);
    return;
  }
  if (await isBlockPage(page)) throw new BlockedError(searchTerm);
  throw new Error(`No search results loaded for "${searchTerm}" after a reload (${await pageState(page)})`);
}

/**
 * How long to wait before re-checking sponsored badges when the first pass
 * found none.
 */
const SPONSORED_RETRY_DELAY_MS = 1_500;

/**
 * Re-run sponsored detection on every card when the first pass found no ads.
 *
 * Walmart renders the "Sponsored" tag on the server, so a race with a
 * client-side ad script is unlikely — but an all-organic page is still worth
 * one cheap second look, because posting it as-is stores a row with five
 * organic slots and no competitor at all. Costs 1.5 s only on a query that
 * found zero ads.
 *
 * Mutates `products[i].isSponsored` in place and returns how many cards are
 * sponsored after the retry. Walmart serves no ads on some niche terms, so a
 * genuine zero is normal; the log line says so.
 */
export async function retrySponsoredDetection(
  cards: Locator,
  products: Product[],
  searchTerm: string,
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
    if (!products[i].wpid) continue;
    if (await detectSponsored(cards.nth(i))) {
      products[i].isSponsored = true;
      found++;
    }
  }

  if (found > 0) {
    console.warn(`[SPONSORED] "${searchTerm}": retry detected ${found}/${products.length} sponsored`);
  } else {
    console.warn(
      `[SPONSORED] "${searchTerm}": still 0 sponsored after retry — the comp slots will be empty ` +
        'for this row. Normal for a term nobody bids on; if the page visibly shows "Sponsored" ' +
        'tags, run `npx tsx scripts/check-sponsored.ts "<term>"` to see which signal moved.',
    );
  }
  return found;
}

/**
 * Walmart fills the delivery badges ("Free shipping, arrives tomorrow") from a
 * per-location fulfillment lookup that can land a beat after the tiles
 * themselves. Normally 17-20 of the top 20 tiles carry one, so give the first
 * one a few seconds to show up before reading the grid; a grid still without
 * any is logged with its first tile's badges so a blank delivery column can be
 * told apart from a parser miss.
 */
const DELIVERY_BADGE_WAIT_MS = 5_000;

async function waitForDeliveryBadges(page: Page, searchTerm: string): Promise<void> {
  const badges = page.locator(`${SELECTORS.resultCard} ${SELECTORS.badges}`);
  const deadline = Date.now() + DELIVERY_BADGE_WAIT_MS;
  while (Date.now() < deadline) {
    const texts = await badges.allInnerTexts().catch(() => [] as string[]);
    if (texts.some((t) => /\b(?:arriv|deliver|shipping)/i.test(t))) return;
    await sleep(500);
  }
  const first = await page
    .locator(SELECTORS.resultCard)
    .first()
    .locator(SELECTORS.badges)
    .allInnerTexts()
    .catch(() => [] as string[]);
  console.warn(
    `[SCRAPE] "${searchTerm}": no delivery badge on any tile after ${DELIVERY_BADGE_WAIT_MS}ms — ` +
      `delivery_days will be null for this term. First tile's badges: ${JSON.stringify(first)}`,
  );
}

export async function scrapeSearchTerm(
  page: Page,
  marketplace: MarketplaceConfig,
  searchTerm: string,
): Promise<Product[]> {
  const url = buildSearchUrl(marketplace, searchTerm);
  console.log(`[SCRAPE] GET ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await waitForResults(page, searchTerm);

  // Walmart server-renders the whole first page (40 tiles) but lazy-loads
  // images and some badge content. A few page-downs settle the top rows.
  for (let s = 0; s < 3; s++) {
    await page.mouse.wheel(0, 1200);
    await sleep(400);
  }

  await waitForDeliveryBadges(page, searchTerm);

  const cards = page.locator(SELECTORS.resultCard);
  const total = await cards.count();
  const take = Math.min(total, config.topNResults);

  const products: Product[] = [];
  for (let i = 0; i < take; i++) {
    try {
      const product = await extractProduct(cards.nth(i), i + 1, marketplace.currency);
      products.push(product);
    } catch (err) {
      console.warn(`[SCRAPE] Failed to extract product at position ${i + 1}:`, err);
      products.push({
        position: i + 1,
        wpid: null,
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

  // Guard against the classic ad-detector failure: a selector that matches
  // every card. Walmart's ad load is a minority of the grid (12 of 52 on the
  // verification query), so a 100% sponsored page means a signal went broad.
  // Warn rather than silently posting a page of false positives.
  if (products.length > 1 && products.every((p) => p.isSponsored)) {
    console.warn(
      `[SCRAPE] SUSPECT: all ${products.length} cards flagged sponsored for "${searchTerm}". ` +
        'A sponsored signal has gone broad — run `npx tsx scripts/check-sponsored.ts` ' +
        'to see which one is over-matching before trusting this result.',
    );
  }

  return products;
}
