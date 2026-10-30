import { Page } from 'playwright';
import { Review } from './types';
import { normalizeText, parseCompactCount, parseRating } from './util';

/**
 * Walmart's product and review pages are Next.js pages, and the server puts
 * the whole page model into `<script id="__NEXT_DATA__">`: the product (name,
 * ids, average rating, rating count, price, fulfillment options with dates)
 * and the reviews (per-star counts, the page of reviews, pagination). That
 * block is read first everywhere; the DOM hooks below are the fallback when a
 * field is missing from it.
 *
 * Verified on www.walmart.com, 2026-10-13, Apple AirPods 4 (wpid 243ESPUGUSOJ,
 * item 11381374703).
 */
export const SELECTORS = {
  nextData: 'script#__NEXT_DATA__',
  /** "4.3 out of 5 stars (4.3) 86K ratings" or "(No ratings yet)". */
  ratingWidget: '[data-testid="reviews-and-ratings"]',
  /** The three "How you'll get this item" tiles. */
  fulfillmentTiles: '[data-testid="shipping-tile"], [data-testid="delivery-tile"], [data-testid="pickup-tile"]',
  /** "Ships to Sacramento, 95829 Arrives by Tomorrow" — a second delivery line. */
  fulfillmentZone: '[data-testid="fulfillment-zone-2"]',
  title: 'h1',
  /** Review cards on the reviews page, for the count fallback only. */
  reviewCard: '[data-testid="review-card"], [data-testid*="review" i]',
} as const;

/** The parts of `__NEXT_DATA__.props.pageProps.initialData.data.product` read here. */
export interface WalmartProductData {
  id?: string | null;
  usItemId?: string | null;
  canonicalUrl?: string | null;
  name?: string | null;
  brand?: string | null;
  averageRating?: number | null;
  numberOfReviews?: number | null;
  availabilityStatus?: string | null;
  priceInfo?: { currentPrice?: { price?: number | null; currencyUnit?: string | null } | null } | null;
  fulfillmentOptions?: Array<{
    type?: string;
    availabilityStatus?: string;
    speedDetails?: {
      fulfillmentBadge?: string | null;
      slaDayEnum?: string | null;
      deliveryDate?: string | null;
      storeDeliveryDate?: string | null;
      slaInMins?: number | null;
    } | null;
  }> | null;
}

/** The parts of `…initialData.data.reviews` read here. */
export interface WalmartReviewsData {
  totalReviewCount?: number | null;
  averageOverallRating?: number | null;
  ratingValueOneCount?: number | null;
  ratingValueTwoCount?: number | null;
  reviewsWithTextRatingOneCount?: number | null;
  reviewsWithTextRatingTwoCount?: number | null;
  customerReviews?: Array<{
    reviewId?: string | null;
    rating?: number | null;
    reviewTitle?: string | null;
    reviewText?: string | null;
    reviewSubmissionTime?: string | null;
    userNickname?: string | null;
    badges?: Array<{ id?: string | null }> | null;
  }> | null;
  pagination?: { total?: number | null; next?: { url?: string | null } | null } | null;
}

export interface WalmartPageData {
  product: WalmartProductData | null;
  reviews: WalmartReviewsData | null;
}

/** Read the page's Next.js data block. Both halves null when absent. */
export async function readPageData(page: Page): Promise<WalmartPageData> {
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { product: null, reviews: null };
      try {
        const j = JSON.parse(el.textContent || 'null');
        const d = j?.props?.pageProps?.initialData?.data;
        return { product: d?.product ?? null, reviews: d?.reviews ?? null };
      } catch {
        return { product: null, reviews: null };
      }
    }, SELECTORS.nextData);
  } catch {
    return { product: null, reviews: null };
  }
}

/** A product block that names a real item: the unknown-wpid page ships an empty one. */
export function isRealProduct(product: WalmartProductData | null): boolean {
  return !!product && !!(product.usItemId || product.name);
}

/**
 * Poll for the product block rather than sleeping a fixed interval. Returns
 * false on timeout.
 */
export async function waitForProductData(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        try {
          const p = JSON.parse(el.textContent || 'null')?.props?.pageProps?.initialData?.data?.product;
          return !!p && (!!p.usItemId || !!p.name);
        } catch {
          return false;
        }
      },
      SELECTORS.nextData,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

/** Walmart's own "Uh-oh... This page could not be found." page. */
export async function isNotFoundPage(page: Page): Promise<boolean> {
  try {
    const body = await page.locator('body').innerText({ timeout: 2_000 });
    return /this page could not be found|page not found/i.test(body);
  } catch {
    return false;
  }
}

/** Rating + count off the visible widget, for when the data block lacks them. */
export async function ratingFromDom(page: Page): Promise<{ rating: number | null; count: number | null }> {
  try {
    const loc = page.locator(SELECTORS.ratingWidget).first();
    if ((await loc.count()) === 0) return { rating: null, count: null };
    const text = normalizeText(await loc.innerText({ timeout: 2_000 }));
    const rating = parseRating(text);
    const countText = text.match(/([\d.,]+\s*[KM]?)\s*ratings?/i)?.[1] ?? null;
    return { rating, count: rating === null ? null : parseCompactCount(countText) };
  } catch {
    return { rating: null, count: null };
  }
}

/** The visible fulfillment tile texts, for when the data block lacks options. */
export async function fulfillmentTileTexts(page: Page): Promise<string[]> {
  const lines: string[] = [];
  for (const sel of [SELECTORS.fulfillmentTiles, SELECTORS.fulfillmentZone]) {
    try {
      lines.push(...(await page.locator(sel).allInnerTexts()));
    } catch {
      // next source
    }
  }
  return lines;
}

/** Map one page of Walmart review objects onto the backend's review shape. */
export function toReviews(data: WalmartReviewsData | null): Review[] {
  return (data?.customerReviews || [])
    .filter((r) => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5)
    .map((r) => ({
      reviewId: normalizeText(r.reviewId) || undefined,
      rating: r.rating as number,
      title: normalizeText(r.reviewTitle) || undefined,
      text: normalizeText(r.reviewText) || undefined,
      author: normalizeText(r.userNickname) || undefined,
      date: normalizeText(r.reviewSubmissionTime) || undefined,
      verifiedPurchase: (r.badges || []).some((b) => /verified/i.test(b.id || '')),
    }));
}

/** How many 1–2 star reviews (with text, i.e. harvestable) Walmart reports. */
export function criticalExpected(data: WalmartReviewsData | null): number | null {
  if (!data) return null;
  const one = data.reviewsWithTextRatingOneCount ?? data.ratingValueOneCount;
  const two = data.reviewsWithTextRatingTwoCount ?? data.ratingValueTwoCount;
  if (typeof one !== 'number' || typeof two !== 'number') return null;
  return one + two;
}
