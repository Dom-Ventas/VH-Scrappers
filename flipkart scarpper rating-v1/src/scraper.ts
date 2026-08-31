import { Page } from 'playwright';

import { config } from './config';

import {
  extractProductDetails,
  extractDeliveryPromise,
  extractPincodeApplied,
  extractAplusContent,
  extractReviewsFromApi,
  extractReviewsFromDom
} from './extractors';

import {
  fetchPageData,
  fetchReviewPageData,
  reviewTotalPages,
  looksLikeReviewPage
} from './pageApi';

import {
  ProductReviewResult,
  Review
} from './types';

import { sleep } from './util';

function cleanDomain(
  domain: string
): string {

  return domain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

/**
 * The PID resolves without knowing the product's URL slug, which is the
 * Flipkart equivalent of Amazon's /dp/<ASIN>. The "itme" placeholder is what
 * Flipkart itself uses when the slug is unknown.
 */
function buildProductUrl(
  domain: string,
  pid: string
): string {

  return `https://${cleanDomain(domain)}/product/p/itme?pid=${pid}`;
}

/**
 * Flipkart accepts `rating=` on this URL but silently ignores it, and the star
 * histogram is display-only — there is no critical-review filter to request.
 * Reviews are therefore pulled most-recent-first and filtered locally.
 */
function buildReviewUrl(
  domain: string,
  pid: string,
  pageNumber: number
): string {

  return (
    `https://${cleanDomain(domain)}/product/product-reviews/itme` +
    `?pid=${pid}&sortOrder=MOST_RECENT&page=${pageNumber}`
  );
}

/**
 * Flipkart interrupts some entries with a login modal. It is dismissable and
 * never blocks review reading, so this is best-effort.
 */
async function dismissLoginModal(
  page: Page
): Promise<void> {

  try {

    await page
      .locator('button:has-text("✕")')
      .first()
      .click({ timeout: 1500 });

    console.log('[MODAL] Dismissed login prompt');

    return;

  } catch {}

  await page.keyboard.press('Escape').catch(() => {});
}

export async function scrapePid(
  page: Page,
  domain: string,
  pid: string
): Promise<ProductReviewResult> {

  const productUrl = buildProductUrl(domain, pid);

  console.log(`[SCRAPE] GET ${productUrl}`);

  await page.goto(
    productUrl,
    {
      waitUntil: 'domcontentloaded'
    }
  );

  await dismissLoginModal(page);

  console.log('[PRODUCT TITLE]', await page.title());

  // An unknown PID does not 404 — Flipkart redirects to the homepage, which has
  // no product JSON-LD. extractProductDetails throws on that, so the only guard
  // needed here is waiting for the JSON-LD to exist.
  try {

    await page.waitForSelector(
      'script[type="application/ld+json"]',
      {
        // A <script> tag is never visible, and 'visible' is waitForSelector's
        // default — without this it times out on every valid product page.
        state: 'attached',

        timeout: config.resultsWaitTimeoutMs
      }
    );

  } catch {

    throw new Error(
      `No product page loaded for PID "${pid}"`
    );
  }

  const pageData = await fetchPageData(page, pid);

  const product = await extractProductDetails(
    page,
    pid,
    pageData
  );

  product.pincodeApplied = await extractPincodeApplied(page);

  if (product.pincodeApplied === false) {
    console.warn(
      `[PINCODE] ${pid} -> Flipkart still reports "Location not set". ` +
        'Delivery promises are geo-guessed and will drift between runs. ' +
        'Re-run first setup to pin a delivery location.'
    );
  } else if (product.pincodeApplied === null) {
    console.warn(
      `[PINCODE] ${pid} -> no delivery section rendered, so the pincode state ` +
        'is unknown. Any delivery value from this page is suspect.'
    );
  }

  try {

    const delivery = await extractDeliveryPromise(page);

    // Whole number of days when a promise is shown, null when the page has
    // none (out of stock, no offer) — so 0 stays reserved for same-day.
    product.deliveryPromiseDays = delivery.days;
    product.deliveryText = delivery.text;

  } catch (err) {

    console.warn('[DELIVERY] Failed to read delivery promise', err);
    product.deliveryPromiseDays = null;
    product.deliveryText = '';
  }

  console.log(
    `[DELIVERY PROMISE] ${pid} -> ${product.deliveryPromiseDays} day(s)`
  );

  const aplus = await extractAplusContent(page, pid, pageData);

  // The module count and which signal answered are logged for debugging only —
  // the scraped field is just yes/no.
  console.log(
    `[A+ CONTENT] ${pid} -> ${aplus.aplus} ` +
      `(via ${aplus.source}, ${aplus.featureCount} module(s) seen)`
  );

  product.aplus_content = aplus.aplus;
  product.aplusContent = aplus.aplus;

  product.criticalReviews = await collectCriticalReviews(
    page,
    domain,
    pid
  );

  console.log(
    `[FILTER] ${product.criticalReviews.length} critical reviews kept`
  );

  return product;
}

/**
 * Walks the review pages most-recent-first, keeping only 1–2 star reviews.
 *
 * Flipkart serves 10 reviews per page with no critical-only filter, so the two
 * limits below bound what is otherwise an unbounded crawl: on a product where
 * critical reviews are ~6% of the total, collecting a few hundred would mean
 * thousands of page loads.
 */
async function collectCriticalReviews(
  page: Page,
  domain: string,
  pid: string
): Promise<Review[]> {

  const criticalReviews: Review[] = [];

  const firstUrl = buildReviewUrl(domain, pid, 1);

  console.log('[FLIPKART REVIEW URL]', firstUrl);

  try {

    await page.goto(
      firstUrl,
      {
        waitUntil: 'domcontentloaded'
      }
    );

    await dismissLoginModal(page);

  } catch (err) {

    console.warn('[REVIEWS] Failed to open the review page', err);

    return criticalReviews;
  }

  let totalPages: number | null = null;

  // The API path needs no navigation — it addresses pages by number — but the
  // DOM path can only read the page the browser is actually on. Tracking which
  // path is in use keeps the two from being confused, and stops a product whose
  // API is refusing requests from paying two failed calls plus a retry sleep on
  // every single page.
  let useApi = true;

  // Guards against re-reading the same page forever. Any page that yields no
  // review we have not already seen means the crawl has stopped advancing.
  const seen = new Set<string>();

  for (
    let reviewPage = 1;
    reviewPage <= config.maxReviewPages;
    reviewPage++
  ) {

    let pageReviews: Review[] = [];

    if (useApi) {

      const reviewData = await fetchReviewPageData(page, pid, reviewPage);

      if (looksLikeReviewPage(reviewData)) {

        if (totalPages === null) {
          totalPages = reviewTotalPages(reviewData);

          if (totalPages !== null) {
            console.log(`[REVIEWS] ${totalPages} review page(s) available`);
          }
        }

        pageReviews = extractReviewsFromApi(reviewData);

        console.log(
          `[REVIEWS] ${pageReviews.length} review(s) via page API`
        );

      } else {

        useApi = false;

        console.warn(
          `[REVIEWS] ${pid} -> page API unusable, using the rendered page for ` +
            'the rest of this product (long review bodies will be truncated)'
        );
      }
    }

    if (!useApi) {

      // Must navigate: the DOM only ever shows the page the browser is on.
      try {

        await page.goto(
          buildReviewUrl(domain, pid, reviewPage),
          {
            waitUntil: 'domcontentloaded'
          }
        );

        await dismissLoginModal(page);

      } catch (err) {

        console.warn(
          `[REVIEWS] Failed to load review page ${reviewPage}`,
          err
        );

        break;
      }

      pageReviews = await extractReviewsFromDom(page);
    }

    if (pageReviews.length === 0) {

      console.log(
        `[REVIEWS] No reviews on page ${reviewPage} — end of list`
      );

      break;
    }

    const fresh = pageReviews.filter(review => {
      const key =
        review.reviewId ||
        `${review.rating}|${review.title}|${review.text}|${review.author}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    if (fresh.length === 0) {

      console.log(
        `[REVIEWS] Page ${reviewPage} repeated reviews already collected — ` +
          'pagination is not advancing, stopping here'
      );

      break;
    }

    const critical = fresh.filter(
      review => review.rating > 0 && review.rating <= 2
    );

    criticalReviews.push(...critical);

    console.log(
      `[REVIEWS] Page ${reviewPage}: ${critical.length} critical ` +
        `of ${fresh.length} | total ${criticalReviews.length}`
    );

    if (criticalReviews.length >= config.maxCriticalReviews) {

      console.log(
        `[REVIEWS] Reached limit of ${config.maxCriticalReviews}`
      );

      break;
    }

    if (totalPages !== null && reviewPage >= totalPages) {

      console.log(
        `[REVIEWS] Reached the last review page (${totalPages})`
      );

      break;
    }

    if (reviewPage === config.maxReviewPages) {

      console.log(
        `[REVIEWS] Safety page limit reached (${config.maxReviewPages}` +
          `${totalPages !== null ? ` of ${totalPages}` : ''}). ` +
          'Older critical reviews beyond this point were not scanned.'
      );

      break;
    }

    await sleep(config.reviewPageDelayMs);
  }

  return criticalReviews.slice(0, config.maxCriticalReviews);
}
