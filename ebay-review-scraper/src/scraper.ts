import { Page } from 'playwright';
import { config } from './config';
import { MarketplaceConfig } from './marketplaces';
import {
  criticalExpected,
  readListingPage,
  readReviewsPage,
  toReviews,
  waitForListing,
  waitForReviews,
} from './extractors';
import { ProductReviewResult, Review } from './types';
import { parseEbayPrice, PermanentError, pickDelivery, sleep } from './util';

/** Reviews with this rating or lower are the "critical" set, as on Amazon. */
const CRITICAL_MAX_RATING = 2;

function cleanHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** An item number opens its listing on every eBay site. */
export function buildListingUrl(marketplace: MarketplaceConfig, itemId: string): string {
  return `https://${cleanHost(marketplace.url)}/itm/${encodeURIComponent(itemId.trim())}`;
}

/**
 * The catalogue product's reviews, lowest rating first (`sort=+rating`), which
 * is what makes the harvest cheap: stop at the first page that holds a review
 * above CRITICAL_MAX_RATING. `_itm` keeps eBay's "See listing" link on our
 * item; the slug eBay puts before `product-reviews` is optional.
 */
export function buildReviewsUrl(
  marketplace: MarketplaceConfig,
  epid: string,
  itemId: string,
  pageNo: number,
): string {
  return (
    `https://${cleanHost(marketplace.url)}/urw/product-reviews/${encodeURIComponent(epid)}` +
    `?_itm=${encodeURIComponent(itemId)}&sort=%2Brating&pgn=${pageNo}`
  );
}

/**
 * eBay fronts its site with Akamai Bot Manager: a blocked session gets
 * "Pardon Our Interruption…" / "Security Measure" instead of the page.
 */
export async function isBlockPage(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (/pardon our interruption|security measure|access denied/i.test(title)) return true;
    const body = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    return /pardon our interruption|checking your browser|verify yourself|please verify you are a human|sicherheitsma(?:ß|ss)nahme|entschuldigung für die unterbrechung/i.test(body);
  } catch {
    return false;
  }
}

/** Thrown when eBay served its bot check instead of a page. */
export class BlockedError extends Error {
  constructor(what: string) {
    super(
      `eBay served its bot check ("Pardon Our Interruption") instead of ${what}. ` +
        "Run once with BROWSER_VISIBLE=1, complete the check in the scraper's Chrome profile, " +
        'and retry; raise SCRAPE_DELAY_MS if it keeps happening.',
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

  console.warn(`[BLOCK] ${what}: eBay served its bot check; waiting up to ${BLOCK_CLEAR_WAIT_MS / 1000}s for it to clear...`);
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

export async function scrapeProduct(
  page: Page,
  marketplace: MarketplaceConfig,
  itemId: string,
): Promise<ProductReviewResult> {
  // ─── LISTING PAGE ─────────────────────────────────────────────────────────
  const listingUrl = buildListingUrl(marketplace, itemId);
  console.log(`[SCRAPE] GET ${listingUrl}`);
  const ok = await openPage(page, listingUrl, `the listing for ${itemId}`, () =>
    waitForListing(page, config.resultsWaitTimeoutMs),
  );
  if (!ok) {
    throw new Error(`No listing for ${itemId} after ${config.resultsWaitTimeoutMs}ms (page title: "${await page.title()}")`);
  }
  const listing = await readListingPage(page, itemId);
  if (listing.notFound) {
    throw new PermanentError(`Unknown item ${itemId}: eBay says "Looks like this page is missing"`);
  }

  const delivery = pickDelivery(listing.deliveryText);
  const result: ProductReviewResult = {
    itemId,
    epid: listing.epid,
    title: listing.title,
    rating: null,
    ratingCount: null,
    criticalReviews: [],
    criticalExpected: null,
    deliveryPromiseDays: delivery.deliveryDays,
    deliveryText: delivery.deliveryText,
    price: parseEbayPrice(listing.priceText, marketplace.decimalComma),
    currency: marketplace.currency,
  };

  console.log(
    `[PRODUCT] "${result.title}" epid=${listing.epid ?? 'none'} ` +
      `delivery=${delivery.deliveryDays ?? 'null'} (${delivery.deliveryText ?? '-'})`,
  );

  // ─── PRODUCT REVIEWS ──────────────────────────────────────────────────────
  // Star reviews exist only for listings matched to an eBay catalogue product.
  // Without one, eBay has nothing but seller feedback (positive / neutral /
  // negative, not stars), which is deliberately not sent: rating and
  // rating_count go out null and critical_reviews empty.
  if (!listing.epid) {
    console.log(`[REVIEWS] ${itemId}: listing is not matched to a catalogue product; no star reviews on eBay`);
    return result;
  }

  const critical: Review[] = [];
  // Each review is kept once, by eBay's review id (else author+date+text):
  // the pinned "TOP CRITICAL" review can come back again inside the list.
  const seen = new Set<string>();
  const keyOf = (r: Review) => r.reviewId || `${r.author}|${r.date}|${r.text}`;
  for (let pageNo = 1; pageNo <= config.maxReviewPages; pageNo++) {
    const url = buildReviewsUrl(marketplace, listing.epid, itemId, pageNo);
    console.log(`[REVIEWS] GET ${url}`);
    const loaded = await openPage(page, url, `reviews page ${pageNo} of ${itemId}`, () =>
      waitForReviews(page, config.resultsWaitTimeoutMs),
    );
    if (!loaded) {
      console.warn(`[REVIEWS] page ${pageNo}: no review data (title "${await page.title()}"); stopping`);
      break;
    }
    const data = await readReviewsPage(page, pageNo);
    if (pageNo === 1) {
      result.rating = data.rating;
      result.ratingCount = data.ratingCount;
      result.criticalExpected = criticalExpected(data.histogram);
      console.log(
        `[REVIEWS] product rating ${data.rating ?? 'null'} from ${data.ratingCount ?? 'null'} ratings; ` +
          `histogram ${JSON.stringify(data.histogram)}`,
      );
      if (!data.ratingCount) break;
      if (result.criticalExpected === 0) {
        console.log('[REVIEWS] no 1-2 star ratings on this product');
        break;
      }
    }

    const pageReviews = toReviews(data.reviews);
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
    // later page is 3 stars or better. The pinned reviews ignore the sort, so
    // they never count here.
    const sorted = data.reviews.filter((r) => !r.pinned);
    if (sorted.some((r) => typeof r.rating === 'number' && r.rating > CRITICAL_MAX_RATING)) {
      console.log('[REVIEWS] ratings have passed 2 stars, no critical reviews left');
      break;
    }
    if (result.criticalExpected != null && critical.length >= result.criticalExpected) break;
    if (!data.hasNext) {
      console.log('[REVIEWS] last page reached');
      break;
    }
    await sleep(config.reviewPageDelayMs);
  }

  result.criticalReviews = critical.slice(0, config.maxCriticalReviews);
  console.log(`[FILTER] ${result.criticalReviews.length} critical reviews kept`);
  return result;
}
