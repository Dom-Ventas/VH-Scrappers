import { config } from '../config';
import { authFetch } from './auth';
import { ProductReviewResult, Query, ScrapedResult } from '../types';

/** Integer >= 0, else null. */
export function toCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * 0–5 rounded to 2 decimals, else null. A product with no ratings reports a
 * rating of 0 (or none) — that is "no rating", not a zero-star average, so it
 * goes out as null.
 */
export function toRating(value: number | null | undefined, count: number | null | undefined): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 5 ||
    (value === 0 && !count)
  ) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

/** Build the POST body for one queue item from what its product page showed. */
export function toScrapedResult(q: Query, product: ProductReviewResult): ScrapedResult {
  return {
    store_id: q.storeId,
    product_ids: q.productIds,
    rating: toRating(product.rating, product.ratingCount),
    rating_count: toCount(product.ratingCount),
    critical_reviews: { reviews: product.criticalReviews },
    // eBay has no A+ content module.
    aplus_content: null,
    delivery_promise_days: toCount(product.deliveryPromiseDays),
    epid: product.epid,
    price: product.price,
    currency: product.currency,
  };
}

/**
 * POST one product page's result to VentaWiz (/v1/scrapper/reviews). A 404
 * means a product id is not a focused listing of that store; it is thrown with
 * the body text like any other non-2xx, so the item is [FAIL]ed.
 */
export async function postScrapedResult(result: ScrapedResult): Promise<void> {
  if (!config.resultsApiUrl) {
    throw new Error('RESULTS_API_URL is not set. Add it to your .env file.');
  }
  const res = await authFetch(config.resultsApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(result),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`postScrapedResult ${res.status} ${res.statusText} ${text}`);
  }
}
