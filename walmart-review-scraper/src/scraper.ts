import { Page } from 'playwright';
import { config } from './config';
import { MarketplaceConfig } from './marketplaces';
import {
  criticalExpected,
  fulfillmentTileTexts,
  isNotFoundPage,
  isRealProduct,
  ratingFromDom,
  readPageData,
  toReviews,
  waitForProductData,
  WalmartProductData,
} from './extractors';
import { ProductReviewResult, Review } from './types';
import { normalizeText, PermanentError, pickDeliveryFromOptions, pickDeliveryFromTiles, sleep } from './util';

/** Reviews with this rating or lower are the "critical" set, as on Amazon. */
const CRITICAL_MAX_RATING = 2;

function cleanHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** walmart.com resolves a product page from the wpid alone. */
export function buildProductUrl(marketplace: MarketplaceConfig, wpid: string): string {
  return `https://${cleanHost(marketplace.url)}/ip/${encodeURIComponent(wpid.trim())}`;
}

/**
 * The reviews page only answers to the NUMERIC item id (a wpid there returns
 * an empty page). `sort=rating-asc` puts the 1-star reviews first, which is
 * what makes the harvest cheap: stop at the first page that holds a review
 * above CRITICAL_MAX_RATING instead of walking all 682 pages.
 */
export function buildReviewsUrl(marketplace: MarketplaceConfig, itemId: string, pageNo: number): string {
  return `https://${cleanHost(marketplace.url)}/reviews/product/${encodeURIComponent(itemId)}?sort=rating-asc&page=${pageNo}`;
}

/**
 * Walmart fronts its site with a bot check (PerimeterX): a page titled "Robot
 * or human?" with a press-and-hold widget. Only the title and the challenge
 * wording are trusted — the hidden `#px-captcha` container also sits on
 * ordinary pages.
 */
export async function isBlockPage(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (/robot or human/i.test(title)) return true;
    const body = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    return /robot or human|press\s*(?:&|and)\s*hold|activate and hold the button/i.test(body);
  } catch {
    return false;
  }
}

/** Thrown when Walmart served its bot check instead of a page for a product. */
export class BlockedError extends Error {
  constructor(what: string) {
    super(
      `Walmart served its "Robot or human?" check instead of ${what}. ` +
        'Run once with BROWSER_VISIBLE=1, complete the press-and-hold check in the scraper\'s ' +
        'Chrome profile, and retry; raise SCRAPE_DELAY_MS if it keeps happening.',
    );
    this.name = 'BlockedError';
  }
}

const BLOCK_CLEAR_WAIT_MS = 45_000;
const BLOCK_POLL_MS = 3_000;

/**
 * Open a URL and wait until `ready()` says the page is usable, surviving a
 * transient bot check: poll for it to clear, reload once, then give up with
 * BlockedError. Returns false when the page loaded but never became ready.
 */
async function openPage(page: Page, url: string, what: string, ready: () => Promise<boolean>): Promise<boolean> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (await ready()) return true;
  if (!(await isBlockPage(page))) return false;

  console.warn(`[BLOCK] ${what}: Walmart served its bot check; waiting up to ${BLOCK_CLEAR_WAIT_MS / 1000}s for it to clear...`);
  const deadline = Date.now() + BLOCK_CLEAR_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(BLOCK_POLL_MS);
    if (!(await isBlockPage(page)) && (await ready())) {
      console.warn(`[BLOCK] ${what}: cleared without a reload`);
      return true;
    }
  }
  console.warn(`[BLOCK] ${what}: still blocked; reloading once`);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  if (await ready()) {
    console.warn(`[BLOCK] ${what}: cleared after reload`);
    return true;
  }
  if (await isBlockPage(page)) throw new BlockedError(what);
  return false;
}

async function productReady(page: Page): Promise<boolean> {
  return waitForProductData(page, config.resultsWaitTimeoutMs);
}

async function readProductPage(page: Page, url: string, wpid: string): Promise<WalmartProductData> {
  console.log(`[SCRAPE] GET ${url}`);
  const ok = await openPage(page, url, `the product page for ${wpid}`, () => productReady(page));
  if (!ok) {
    if (await isNotFoundPage(page)) {
      throw new PermanentError(`Unknown wpid ${wpid}: Walmart says "This page could not be found"`);
    }
    throw new Error(
      `No product data for ${wpid} after ${config.resultsWaitTimeoutMs}ms (page title: "${await page.title()}")`,
    );
  }
  const { product } = await readPageData(page);
  if (!isRealProduct(product)) {
    // The unknown-wpid page ships an empty product object alongside its
    // "could not be found" copy; both say the same thing.
    throw new PermanentError(`Unknown wpid ${wpid}: Walmart returned no product (page not found)`);
  }
  return product as WalmartProductData;
}

export async function scrapeProduct(
  page: Page,
  marketplace: MarketplaceConfig,
  wpid: string,
): Promise<ProductReviewResult> {
  // ─── PRODUCT PAGE ─────────────────────────────────────────────────────────
  let product = await readProductPage(page, buildProductUrl(marketplace, wpid), wpid);

  // The wpid URL renders the product, but its ratings widget can come up
  // empty ("No ratings yet") while the canonical /ip/<slug>/<itemId> page has
  // them. When the rating is missing, follow the canonical URL once.
  const canonical = normalizeText(product.canonicalUrl);
  if ((product.averageRating == null || product.numberOfReviews == null) && canonical) {
    const canonicalUrl = canonical.startsWith('http') ? canonical : `https://${cleanHost(marketplace.url)}${canonical}`;
    console.log(`[SCRAPE] rating missing on the wpid page; following canonical ${canonicalUrl}`);
    product = await readProductPage(page, canonicalUrl, wpid);
  }

  const itemId = normalizeText(product.usItemId) || null;
  const title = normalizeText(product.name) || normalizeText(await page.locator('h1').first().innerText({ timeout: 2_000 }).catch(() => '')) || null;

  let rating = typeof product.averageRating === 'number' ? product.averageRating : null;
  let ratingCount = typeof product.numberOfReviews === 'number' ? product.numberOfReviews : null;
  if (rating === null || ratingCount === null) {
    const dom = await ratingFromDom(page);
    if (rating === null) rating = dom.rating;
    if (ratingCount === null) ratingCount = dom.count;
  }

  let delivery = pickDeliveryFromOptions(product.fulfillmentOptions);
  if (delivery.deliveryText === null) delivery = pickDeliveryFromTiles(await fulfillmentTileTexts(page));

  const result: ProductReviewResult = {
    wpid,
    itemId,
    title,
    brand: normalizeText(product.brand) || null,
    rating,
    ratingCount,
    criticalReviews: [],
    criticalExpected: null,
    deliveryPromiseDays: delivery.deliveryDays,
    deliveryText: delivery.deliveryText,
    price: typeof product.priceInfo?.currentPrice?.price === 'number' ? product.priceInfo.currentPrice.price : null,
    currency: normalizeText(product.priceInfo?.currentPrice?.currencyUnit) || marketplace.currency,
    availability: normalizeText(product.availabilityStatus) || null,
  };

  console.log(
    `[PRODUCT] "${result.title}" item=${itemId} rating=${rating} ratings=${ratingCount} ` +
      `delivery=${delivery.deliveryDays ?? 'null'} (${delivery.deliveryText ?? '-'})`,
  );

  // ─── REVIEWS PAGES ────────────────────────────────────────────────────────
  if (!itemId) {
    console.warn(`[REVIEWS] ${wpid}: no numeric item id on the product page; skipping reviews`);
    return result;
  }
  if (!ratingCount) {
    console.log(`[REVIEWS] ${wpid}: product has no ratings; skipping reviews`);
    return result;
  }

  const critical: Review[] = [];
  // Walmart's rating-ascending order is not stable between page loads — tied
  // 1-star reviews come back shuffled — so consecutive pages can overlap.
  // Each review is kept once, by Walmart's review id (else author+date+text).
  const seen = new Set<string>();
  const keyOf = (r: Review) => r.reviewId || `${r.author}|${r.date}|${r.text}`;
  for (let pageNo = 1; pageNo <= config.maxReviewPages; pageNo++) {
    const url = buildReviewsUrl(marketplace, itemId, pageNo);
    console.log(`[REVIEWS] GET ${url}`);
    const ok = await openPage(page, url, `reviews page ${pageNo} of ${wpid}`, async () => {
      // The reviews data block is server-rendered; it is there at domcontentloaded.
      const { reviews } = await readPageData(page);
      return !!reviews;
    });
    if (!ok) {
      console.warn(`[REVIEWS] page ${pageNo}: no review data (title "${await page.title()}"); stopping`);
      break;
    }
    const { reviews } = await readPageData(page);
    if (pageNo === 1) result.criticalExpected = criticalExpected(reviews);

    const pageReviews = toReviews(reviews);
    const crit = pageReviews.filter((r) => r.rating <= CRITICAL_MAX_RATING);
    let repeats = 0;
    for (const r of crit) {
      const key = keyOf(r);
      if (seen.has(key)) {
        repeats++;
        continue;
      }
      seen.add(key);
      critical.push(r);
    }
    console.log(
      `[REVIEWS] page ${pageNo}: ${pageReviews.length} review(s), ${crit.length} critical` +
        (repeats ? `, ${repeats} already seen` : '') +
        ` (total ${critical.length}${result.criticalExpected != null ? ` of ${result.criticalExpected}` : ''})`,
    );

    if (pageReviews.length === 0) break;
    if (critical.length >= config.maxCriticalReviews) {
      console.log(`[REVIEWS] reached limit of ${config.maxCriticalReviews}`);
      break;
    }
    // Sorted ascending: a page holding anything above 2 stars means every
    // later page is 3 stars or better.
    if (pageReviews.some((r) => r.rating > CRITICAL_MAX_RATING)) {
      console.log('[REVIEWS] ratings have passed 2 stars, no critical reviews left');
      break;
    }
    if (result.criticalExpected != null && critical.length >= result.criticalExpected) break;
    if (!reviews?.pagination?.next?.url) {
      console.log('[REVIEWS] last page reached');
      break;
    }
    await sleep(config.reviewPageDelayMs);
  }

  result.criticalReviews = critical.slice(0, config.maxCriticalReviews);
  console.log(`[FILTER] ${result.criticalReviews.length} critical reviews kept`);
  return result;
}
