import { Page, Locator } from 'playwright';

import {
  parseFloatSafe,
  parseIntSafe,
  normalizeText
} from './util';

import {
  ProductReviewResult,
  Review
} from './types';

import { parseDeliveryPromiseDays } from './delivery';

export const SELECTORS = {

  title: [
    '#productTitle',
    '#title',
    'h1 span'
  ],

  rating: [
    '[data-hook="rating-out-of-text"]',
    '#acrPopover',
    '.a-icon-alt'
  ],

  totalRatings: [
    '#acrCustomerReviewText',
    '[data-hook="total-review-count"]'
  ],

  bestSellerRank: [
    '#detailBulletsWrapper_feature_div',
    '#productDetails_detailBullets_sections1',
    '#prodDetails'
  ],

  reviewCards: [
    '[data-hook="review"]',
    '.review',
    '.a-section.review'
  ],

  reviewRating: [
    '[data-hook="review-star-rating"]',
    '[data-hook="cmps-review-star-rating"]',
    '.review-rating',
    '.a-icon-alt'
  ],

  reviewTitle: [
    '[data-hook="review-title"]',
    '.review-title'
  ],

  reviewBody: [
    '[data-hook="review-body"]',
    '.review-text-content span',
    '.review-text'
  ],

  reviewAuthor: [
    '.a-profile-name'
  ],

  reviewDate: [
    '[data-hook="review-date"]'
  ],

  // Delivery promise block on the product page. Ordered most-specific first —
  // the PRIMARY slot holds the standard (free) delivery promise, while the
  // SECONDARY slot holds "Or fastest delivery ...".
  deliveryBlock: [
    '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
    '#deliveryBlockMessage',
    '#delivery-block-message',
    '#ddmDeliveryMessage',
    '#mir-layout-DELIVERY_BLOCK',
    '#fast-track-message',
    '#exports_desktop_qualifiedBuybox_tlc_feature_div',
    '#amazonGlobal_feature_div'
  ]
};

async function firstText(
  pageOrLocator: Page | Locator,
  selectors: string[]
): Promise<string | null> {

  for (const selector of selectors) {

    try {

      const loc =
        pageOrLocator
          .locator(selector)
          .first();

      if (
        (await loc.count()) > 0
      ) {

        const text =
          (
            await loc.textContent()
          )?.trim();

        if (text) {
          return text;
        }
      }

    } catch {}
  }

  return null;
}

async function firstInnerText(
  pageOrLocator: Page | Locator,
  selectors: string[]
): Promise<string | null> {

  for (const selector of selectors) {

    try {

      const loc =
        pageOrLocator
          .locator(selector)
          .first();

      if (
        (await loc.count()) > 0
      ) {

        const text =
          (
            await loc.innerText()
          )?.trim();

        if (text) {
          return text;
        }
      }

    } catch {}
  }

  return null;
}

async function getReviewCards(
  page: Page
): Promise<Locator> {

  for (const selector of SELECTORS.reviewCards) {

    try {

      const cards =
        page.locator(selector);

      if (
        (await cards.count()) > 0
      ) {

        return cards;
      }

    } catch {}
  }

  return page.locator(
    SELECTORS.reviewCards[0]
  );
}

export async function extractProductDetails(
  page: Page,
  asin: string
): Promise<ProductReviewResult> {

  const title =
    normalizeText(
      await firstText(
        page,
        SELECTORS.title
      )
    );

  const ratingText =
    await firstText(
      page,
      SELECTORS.rating
    );

  const totalRatingsText =
    await firstText(
      page,
      SELECTORS.totalRatings
    );

  let bestSellerRank = '';

  try {

    const bodyText =
      await page.textContent(
        'body'
      );

    const rankMatch =
      bodyText?.match(
        /Best Sellers Rank[\s\S]*?#([\d,]+)\s+in\s+([^\n#]+)/i
      );

    if (rankMatch) {

      bestSellerRank =
        `#${rankMatch[1]} in ${rankMatch[2]
          .split('(')[0]
          .trim()}`;
    }

  } catch {

    bestSellerRank = '';
  }

  return {
    asin,

    title,

    rating:
      parseFloatSafe(
        ratingText
      ),

    totalRatings:
      parseIntSafe(
        totalRatingsText
      ),

    bestSellersRank:
      bestSellerRank,

    criticalReviews: []
  };
}

/**
 * Reads the delivery promise off the product page and converts it into a day
 * count relative to today (promise date - today).
 *
 * Returns { days: null } when the page shows no readable delivery promise
 * (out of stock, seller-fulfilled with no date, delivery block not rendered).
 */
export async function extractDeliveryPromise(
  page: Page
): Promise<{ days: number | null; text: string }> {

  let deliveryText = '';

  // 1. Amazon exposes the promise as a clean attribute on the delivery slot,
  //    e.g. data-csa-c-delivery-time="Thursday, August 21". First match in DOM
  //    order is the standard promise; "fastest delivery" comes after it.
  try {
    deliveryText =
      (await page
        .locator('[data-csa-c-delivery-time]')
        .first()
        .getAttribute('data-csa-c-delivery-time')) || '';
  } catch {}

  // 2. Fall back to the rendered text of the delivery block.
  if (!deliveryText) {
    deliveryText =
      (await firstInnerText(
        page,
        SELECTORS.deliveryBlock
      )) ||
      (await firstText(
        page,
        SELECTORS.deliveryBlock
      )) ||
      '';
  }

  deliveryText = normalizeText(deliveryText);

  if (!deliveryText) {
    console.log('[DELIVERY] No delivery block found on page');
    return { days: null, text: '' };
  }

  // Only look at the first line — the block often stacks the standard promise,
  // the fastest promise and the shipping location in one node.
  const primaryLine =
    deliveryText
      .split(/\.\s|\s{2,}|\bOr\b/)[0]
      .trim() || deliveryText;

  const days =
    parseDeliveryPromiseDays(primaryLine) ??
    parseDeliveryPromiseDays(deliveryText);

  console.log(
    `[DELIVERY] "${deliveryText}" -> ${days === null ? 'unparsed' : `${days} day(s)`}`
  );

  return { days, text: deliveryText };
}

export async function extractCriticalReviews(
  page: Page
): Promise<Review[]> {

  const reviews: Review[] =
    [];

  const cards =
    await getReviewCards(page);

  const total =
    await cards.count();

  console.log(
    `[REVIEWS] Found ${total} review cards`
  );

  for (
    let i = 0;
    i < total;
    i++
  ) {

    try {

      const card =
        cards.nth(i);

      const ratingText =
        await firstText(
          card,
          SELECTORS.reviewRating
        );

      console.log(
        `[REVIEW] Rating=${ratingText}`
      );

      const rating =
        parseFloatSafe(
          ratingText
        );

      console.log(
        `[REVIEW] Parsed=${rating}`
      );

      if (
        rating === 0 ||
        Number.isNaN(rating)
      ) {
        continue;
      }

      if (
        rating > 2
      ) {
        continue;
      }

      const title =
        normalizeText(
          await firstText(
            card,
            SELECTORS.reviewTitle
          )
        );

      const text =
        normalizeText(
          await firstText(
            card,
            SELECTORS.reviewBody
          )
        );

      const author =
        normalizeText(
          await firstText(
            card,
            SELECTORS.reviewAuthor
          )
        );

      const date =
        normalizeText(
          await firstText(
            card,
            SELECTORS.reviewDate
          )
        );

      console.log(
        `[CRITICAL] ${rating} stars`
      );

      reviews.push({
        rating,
        title,
        text,
        author,
        date
      });

    } catch (err) {

      console.warn(
        `[REVIEW] Failed review ${i + 1}`,
        err
      );
    }
  }

  console.log(
    `[FILTER] ${reviews.length} critical reviews`
  );

  return reviews;
}