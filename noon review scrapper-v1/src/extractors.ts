import { Page } from 'playwright';

import { normalizeText } from './util';

import {
  ProductReviewResult,
  Review
} from './types';

/**
 * Noon ships hashed CSS-module class names (`_noonReviewItem_1oceu_29`). The
 * hash changes on every Noon CSS deploy, so every selector here prefix-matches
 * on the stable part and never pins the full class.
 */
export const SELECTORS = {
  productTitle: [
    'h1',
    '[class*="productTitle"]'
  ],

  // "Get it Tomorrow" / "Get it 30 August" sits in the buybox estimation slot.
  delivery: [
    '[class*="estimationText"]',
    '[class*="badgeCtr"]',
    '[class*="deliveryEstimation"]'
  ],

  reviewArea: [
    '#ReviewArea'
  ],

  reviewCards: [
    '[class*="noonReviewItem"]'
  ],

  reviewAuthor: [
    '[class*="userName"]'
  ],

  reviewDate: [
    '[class*="ratedDate"]'
  ],

  reviewVerified: [
    '[class*="verifiedPurchaseCover"]'
  ],

  reviewRatingCover: [
    '[class*="ratingCover"]'
  ],

  reviewTitle: [
    '[class*="reviewTitle"]'
  ],

  reviewBody: [
    '[class*="reviewDesc"]'
  ],

  filterControl: [
    '[class*="filterCtr"]'
  ],

  paginationCtr: [
    '[class*="paginationCtr"]'
  ],

  pageLink: [
    '[class*="pageLink"]'
  ],

  cookieAccept: [
    'button:has-text("ACCEPT ALL")',
    'button:has-text("Accept All")',
    'button:has-text("SAVE PREFERENCES")'
  ]
};

export interface NoonProductLd {
  sku?: string;
  name?: string;
  description?: string;
  brand?: { name?: string };
  image?: string[];
  aggregateRating?: {
    ratingValue?: number;
    reviewCount?: number;
    bestRating?: number;
  };
  offers?: {
    availability?: string;
    price?: number;
    priceCurrency?: string;
    shippingDetails?: {
      deliveryTime?: {
        handlingTime?: { minValue?: number; maxValue?: number };
        transitTime?: { minValue?: number; maxValue?: number };
      };
    };
  };
  review?: Array<{
    author?: { name?: string };
    datePublished?: string;
    reviewBody?: string;
    reviewRating?: { ratingValue?: number };
  }>;
}

/**
 * Noon embeds a schema.org Product block on every PDP. It carries the title,
 * rating, rating count, price and structured delivery times, and survives
 * redesigns that would break DOM selectors — so it is always tried first.
 */
export async function readProductJsonLd(
  page: Page
): Promise<NoonProductLd | null> {

  try {

    return await page.evaluate(() => {

      const blocks =
        Array.from(
          document.querySelectorAll(
            'script[type="application/ld+json"]'
          )
        );

      for (const block of blocks) {

        try {

          const parsed =
            JSON.parse(block.textContent || '');

          const list =
            Array.isArray(parsed)
              ? parsed
              : [parsed];

          for (const entry of list) {
            if (entry && entry['@type'] === 'Product') {
              return entry;
            }
          }

        } catch {}
      }

      return null;
    });

  } catch {

    return null;
  }
}

/**
 * Waits for the Product JSON-LD block to be present, which happens after the
 * page hydrates rather than at domcontentloaded. Returns false on timeout.
 *
 * Polling for the real signal beats sleeping a fixed interval and hoping: a
 * slow render used to look identical to a missing product.
 */
export async function waitForProductJsonLd(
  page: Page,
  timeoutMs: number
): Promise<boolean> {

  try {

    await page.waitForFunction(
      () => {

        const blocks =
          Array.from(
            document.querySelectorAll(
              'script[type="application/ld+json"]'
            )
          );

        for (const block of blocks) {

          try {

            const parsed =
              JSON.parse(block.textContent || '');

            const list =
              Array.isArray(parsed) ? parsed : [parsed];

            for (const entry of list) {
              if (entry && entry['@type'] === 'Product') {
                return true;
              }
            }

          } catch {}
        }

        return false;
      },
      undefined,
      { timeout: timeoutMs }
    );

    return true;

  } catch {

    return false;
  }
}

export async function dismissCookieBanner(
  page: Page
): Promise<void> {

  for (const selector of SELECTORS.cookieAccept) {

    try {

      const button =
        page.locator(selector).first();

      if (
        await button.isVisible({ timeout: 1200 })
      ) {

        await button.click({ timeout: 3000 });

        await page.waitForTimeout(700);

        console.log('[COOKIE] banner dismissed');

        return;
      }

    } catch {}
  }
}

async function firstText(
  page: Page,
  selectors: string[]
): Promise<string | null> {

  for (const selector of selectors) {

    try {

      const loc = page.locator(selector).first();

      if ((await loc.count()) > 0) {

        const text = (await loc.textContent())?.trim();

        if (text) {
          return text;
        }
      }

    } catch {}
  }

  return null;
}

export async function extractProductDetails(
  page: Page,
  sku: string,
  ld: NoonProductLd | null
): Promise<ProductReviewResult> {

  const title =
    normalizeText(
      ld?.name ||
        (await firstText(page, SELECTORS.productTitle))
    );

  const rating =
    Number(ld?.aggregateRating?.ratingValue ?? 0) || 0;

  const totalRatings =
    Number(ld?.aggregateRating?.reviewCount ?? 0) || 0;

  return {
    sku,
    title,
    brand: normalizeText(ld?.brand?.name),
    rating,
    totalRatings,
    criticalReviews: [],
    price: ld?.offers?.price ?? null,
    currency: ld?.offers?.priceCurrency,
    availability:
      ld?.offers?.availability
        ?.replace('https://schema.org/', '')
  };
}

// ─── DELIVERY ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

/**
 * Turns Noon's visible promise into a whole day count relative to today:
 *
 *   "Get it Today"         -> 0
 *   "Get it Tomorrow"      -> 1
 *   "Get it 30 August"     -> (Aug 30 - today)
 *
 * Returns null when the text carries no readable promise, so 0 keeps its
 * literal meaning of same-day.
 */
export function parseDeliveryText(
  text: string | null | undefined
): number | null {

  if (!text) {
    return null;
  }

  const value = normalizeText(text).toLowerCase();

  if (!value) {
    return null;
  }

  if (/\btoday\b|\btonight\b/.test(value)) {
    return 0;
  }

  if (/\btomorrow\b/.test(value)) {
    return 1;
  }

  const monthNames = Object.keys(MONTHS).join('|');

  // "30 August" / "30 aug"
  let match =
    value.match(
      new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\b`)
    );

  let day: number | null = null;
  let month: number | null = null;

  if (match) {
    day = parseInt(match[1], 10);
    month = MONTHS[match[2]];
  } else {

    // "August 30" / "aug 30"
    match =
      value.match(
        new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})\\b`)
      );

    if (match) {
      month = MONTHS[match[1]];
      day = parseInt(match[2], 10);
    }
  }

  if (day === null || month === null) {
    return null;
  }

  const now = new Date();

  const today =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

  let target =
    new Date(now.getFullYear(), month, day);

  // A promise that already looks past is next year's date (Dec -> Jan rollover).
  if (target.getTime() < today.getTime() - 7 * 86400000) {
    target = new Date(now.getFullYear() + 1, month, day);
  }

  const days =
    Math.round(
      (target.getTime() - today.getTime()) / 86400000
    );

  return days >= 0 ? days : null;
}

/**
 * Reads the delivery promise. The visible buybox text is authoritative — it is
 * what the customer is actually promised — so JSON-LD handling + transit times
 * are only a fallback for when that text is absent.
 */
export async function extractDeliveryPromise(
  page: Page,
  ld: NoonProductLd | null
): Promise<{ days: number | null; text: string }> {

  const raw =
    await firstText(page, SELECTORS.delivery);

  const text = normalizeText(raw);

  const fromText = parseDeliveryText(text);

  if (fromText !== null) {

    console.log(
      `[DELIVERY] "${text}" -> ${fromText} day(s)`
    );

    return { days: fromText, text };
  }

  const time =
    ld?.offers?.shippingDetails?.deliveryTime;

  const handling = time?.handlingTime?.maxValue;
  const transit = time?.transitTime?.maxValue;

  if (
    typeof handling === 'number' &&
    typeof transit === 'number'
  ) {

    const days = handling + transit;

    console.log(
      `[DELIVERY] json-ld handling=${handling} + transit=${transit} -> ${days} day(s)`
    );

    return {
      days,
      text: `json-ld handling=${handling} transit=${transit}`
    };
  }

  console.log('[DELIVERY] no readable promise on page');

  return { days: null, text };
}

// ─── REVIEWS ──────────────────────────────────────────────────────────────────

/**
 * Reads every review card currently rendered.
 *
 * Noon draws all five stars with the same filled SVG and signals the score
 * through each icon's `color` attribute — "grey3" is an unlit star, anything
 * else (ratingRed, ratingDarkGreen, ...) is lit. So the rating is the count of
 * non-grey icons, which stays correct whatever colour names Noon adds.
 */
export async function extractReviewsOnPage(
  page: Page
): Promise<Review[]> {

  const raw = await page.evaluate(
    (sel: {
      cards: string;
      author: string;
      date: string;
      verified: string;
      ratingCover: string;
      title: string;
      body: string;
    }) => {

      const cards =
        Array.from(
          document.querySelectorAll(sel.cards)
        );

      return cards.map(card => {

        const pick = (selector: string) =>
          (card.querySelector(selector)?.textContent || '').trim();

        const cover =
          card.querySelector(sel.ratingCover);

        let rating = 0;

        if (cover) {

          const icons =
            Array.from(cover.querySelectorAll('img'));

          for (const icon of icons) {
            if (icon.getAttribute('color') !== 'grey3') {
              rating++;
            }
          }
        }

        return {
          rating,
          title: pick(sel.title),
          text: pick(sel.body),
          author: pick(sel.author),
          date: pick(sel.date),
          verifiedPurchase:
            !!card.querySelector(sel.verified)
        };
      });
    },
    {
      cards: SELECTORS.reviewCards[0],
      author: SELECTORS.reviewAuthor[0],
      date: SELECTORS.reviewDate[0],
      verified: SELECTORS.reviewVerified[0],
      ratingCover: SELECTORS.reviewRatingCover[0],
      title: SELECTORS.reviewTitle[0],
      body: SELECTORS.reviewBody[0]
    }
  );

  return raw
    .filter(r => r.rating > 0)
    .map(r => ({
      rating: r.rating,
      title: normalizeText(r.title),
      text: normalizeText(r.text),
      author: normalizeText(r.author),
      date: normalizeText(r.date),
      verifiedPurchase: r.verifiedPurchase
    }));
}
