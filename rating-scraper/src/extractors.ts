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