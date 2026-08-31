import { Page } from 'playwright';

import { config } from './config';

import { MarketplaceConfig } from './marketplaces';

import {
  SELECTORS,
  readProductJsonLd,
  waitForProductJsonLd,
  dismissCookieBanner,
  extractProductDetails,
  extractDeliveryPromise,
  extractReviewsOnPage
} from './extractors';

import {
  ProductReviewResult,
  Review
} from './types';

import { PermanentError } from './util';

/** Reviews with this rating or lower are the "critical" set, as on Amazon. */
const CRITICAL_MAX_RATING = 2;

function cleanHost(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

/**
 * Strips the trailing offer index off a catalog SKU.
 *
 * The backend stores Noon identifiers in their seller-catalog form,
 * `<psku>-<n>`, where the suffix picks one offer within a listing —
 * `ZB417382563712EAF62A5Z-1` and `ZB417382563712EAF62A5Z-10` are two rows
 * against the same product. noon.com addresses PDPs by the psku alone and
 * publishes ratings at that level, so the suffix has to come off before the
 * URL is built; left on, the page answers 404 (and sometimes a bodyless 200).
 *
 * Safe as a blanket rule: every real Noon SKU ends in a letter — `N70140491V`,
 * `Z44E5C508ADFB5FF3C397Z` — so a trailing `-<digits>` is never part of one.
 *
 * The unmodified SKU is still what gets posted back; this only shapes the URL.
 */
export function toPdpSku(sku: string): string {
  return sku.trim().replace(/-\d+$/, '');
}

/**
 * Noon resolves a PDP from the SKU alone and rewrites the canonical URL itself,
 * so no slug lookup is needed — unlike Amazon, where the ASIN path is the only
 * option, and Flipkart, where the slug matters.
 */
export function buildProductUrl(
  marketplace: MarketplaceConfig,
  sku: string
): string {
  return `https://${cleanHost(marketplace.url)}/${toPdpSku(sku)}/p/`;
}

export function buildReviewsUrl(
  marketplace: MarketplaceConfig,
  sku: string
): string {
  return `https://${cleanHost(marketplace.url)}/reviews/${toPdpSku(sku)}/`;
}

/**
 * Switches the reviews list to ascending rating.
 *
 * Noon's star filter and sort are react-select dropdowns with no URL
 * parameters, so they have to be driven through the UI. Sorting by "Lowest
 * Rating" is what makes the harvest cheap: the critical reviews all come first,
 * so we can stop as soon as a page comes back with nothing at or below
 * CRITICAL_MAX_RATING instead of walking all 1,999 pages.
 */
async function sortByLowestRating(
  page: Page
): Promise<boolean> {

  try {

    const control =
      page
        .locator(SELECTORS.filterControl[0])
        .filter({ hasText: 'SORT BY' })
        .first();

    await control.click({ timeout: 10000 });

    await page.waitForTimeout(1200);

    await page
      .getByText('Lowest Rating', { exact: true })
      .first()
      .click({ timeout: 10000 });

    await page.waitForTimeout(3500);

    console.log('[REVIEWS] sorted by Lowest Rating');

    return true;

  } catch (err) {

    console.warn(
      '[REVIEWS] could not apply Lowest Rating sort, falling back to default order',
      (err as Error).message
    );

    return false;
  }
}

/**
 * Clicks through to the next page of reviews.
 *
 * The pagination links carry no href and `?page=` is ignored, so the only way
 * forward is clicking the numbered link. Returns false when there is no next
 * page to go to.
 */
async function goToReviewPage(
  page: Page,
  targetPage: number
): Promise<boolean> {

  try {

    const link =
      page
        .locator(SELECTORS.pageLink[0])
        .filter({ hasText: new RegExp(`^${targetPage}$`) })
        .first();

    if ((await link.count()) === 0) {
      return false;
    }

    await link.scrollIntoViewIfNeeded({ timeout: 5000 });

    await link.click({ timeout: 10000 });

    await page.waitForTimeout(3000);

    return true;

  } catch (err) {

    console.warn(
      `[REVIEWS] failed to open page ${targetPage}`,
      (err as Error).message
    );

    return false;
  }
}

async function loadReviewArea(
  page: Page
): Promise<boolean> {

  // The review list only hydrates once its container enters the viewport.
  try {

    await page
      .locator(SELECTORS.reviewArea[0])
      .first()
      .scrollIntoViewIfNeeded({ timeout: 8000 });

  } catch {}

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });

  await page.waitForTimeout(1500);

  try {

    await page.waitForSelector(
      SELECTORS.reviewCards[0],
      { timeout: config.resultsWaitTimeoutMs }
    );

    return true;

  } catch {

    return false;
  }
}

export async function scrapeSku(
  page: Page,
  marketplace: MarketplaceConfig,
  sku: string
): Promise<ProductReviewResult> {

  // ─── PRODUCT PAGE ───────────────────────────────────────────────────────────
  const productUrl = buildProductUrl(marketplace, sku);

  const pdpSku = toPdpSku(sku);

  if (pdpSku !== sku) {
    console.log(
      `[SKU] "${sku}" -> "${pdpSku}" (offer index stripped for the URL)`
    );
  }

  console.log(`[SCRAPE] GET ${productUrl}`);

  const response =
    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded'
    });

  const status = response?.status() ?? 0;

  // Noon answers an unknown SKU with a real HTTP 404 while every live product
  // returns 200. That status is the only positive evidence that a SKU does not
  // exist, and it is what makes the failure permanent — absence of content is
  // not, because a slow render, a bot block and a dead SKU all look alike in
  // the DOM.
  if (status === 404) {
    throw new PermanentError(
      `Invalid SKU: ${sku} (HTTP 404)`
    );
  }

  await dismissCookieBanner(page);

  // Poll for the structured data rather than sleeping a fixed interval — the
  // block is injected on hydration, not at domcontentloaded.
  const hasJsonLd =
    await waitForProductJsonLd(
      page,
      config.resultsWaitTimeoutMs
    );

  console.log('[PRODUCT TITLE]', await page.title());

  const ld =
    hasJsonLd ? await readProductJsonLd(page) : null;

  // Every live Noon PDP ships a Product JSON-LD block, so reaching here without
  // one means the page did not render — a bot block, a hiccup, a redesign.
  // All of those are retryable: scraping on regardless would post
  // rating=0 / ratingCount=0 for a product that has neither, silently
  // corrupting the data instead of failing.
  if (!ld) {

    const pageTitle = await page.title();

    const blocked =
      /access denied|pardon our interruption|reference #\d|are you a robot|request blocked/i
        .test(pageTitle);

    throw new Error(
      blocked
        ? `Blocked by bot protection for ${sku} (page title: "${pageTitle}")`
        : `No product data for ${sku} after ${config.resultsWaitTimeoutMs}ms ` +
          `(HTTP ${status}, page title: "${pageTitle}")`
    );
  }

  const product =
    await extractProductDetails(page, sku, ld);

  console.log(
    `[PRODUCT] "${product.title}" rating=${product.rating} ratings=${product.totalRatings}`
  );

  // Read the delivery promise before anything scrolls the page.
  try {

    const delivery =
      await extractDeliveryPromise(page, ld);

    product.deliveryPromiseDays = delivery.days;
    product.deliveryText = delivery.text;

  } catch (err) {

    console.warn('[DELIVERY] failed to read promise', err);

    product.deliveryPromiseDays = null;
    product.deliveryText = '';
  }

  // ─── REVIEWS PAGE ───────────────────────────────────────────────────────────
  const reviewsUrl = buildReviewsUrl(marketplace, sku);

  console.log(`[REVIEWS] GET ${reviewsUrl}`);

  await page.goto(reviewsUrl, {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForTimeout(2500);

  await dismissCookieBanner(page);

  const hasReviews = await loadReviewArea(page);

  if (!hasReviews) {

    console.log('[REVIEWS] no review cards rendered');

    product.criticalReviews = [];

    return product;
  }

  const sorted = await sortByLowestRating(page);

  const criticalReviews: Review[] = [];

  let pageNumber = 1;

  while (true) {

    const pageReviews = await extractReviewsOnPage(page);

    const critical =
      pageReviews.filter(
        r => r.rating <= CRITICAL_MAX_RATING
      );

    criticalReviews.push(...critical);

    console.log(
      `[REVIEWS] page ${pageNumber}: ${pageReviews.length} card(s), ` +
        `${critical.length} critical (total ${criticalReviews.length})`
    );

    if (
      criticalReviews.length >=
      config.maxCriticalReviews
    ) {

      console.log(
        `[REVIEWS] reached limit of ${config.maxCriticalReviews}`
      );

      break;
    }

    // With the ascending sort applied, the first page holding no critical
    // review means every later page is 3 stars or better — stop early rather
    // than walking the whole list. Without the sort we cannot assume that, so
    // we keep paging until the safety limit.
    if (sorted && critical.length === 0) {

      console.log(
        '[REVIEWS] ratings have passed 2 stars, no critical reviews left'
      );

      break;
    }

    if (pageNumber >= config.maxReviewPages) {

      console.log(
        `[REVIEWS] safety page limit reached (${config.maxReviewPages})`
      );

      break;
    }

    const moved =
      await goToReviewPage(page, pageNumber + 1);

    if (!moved) {

      console.log('[REVIEWS] last page reached');

      break;
    }

    pageNumber++;
  }

  product.criticalReviews =
    criticalReviews.slice(
      0,
      config.maxCriticalReviews
    );

  console.log(
    `[FILTER] ${product.criticalReviews.length} critical reviews kept`
  );

  return product;
}
