import { test, expect } from '@playwright/test';
import { toCount, toRating, toScrapedResult } from '../src/api/results';
import { ProductReviewResult, Query } from '../src/types';

const q: Query = { productIds: [101, 102], itemId: '265983500898', shortCode: 'EBUS', storeId: 13 };

function product(overrides: Partial<ProductReviewResult> = {}): ProductReviewResult {
  return {
    itemId: '265983500898',
    epid: '17054784938',
    title: 'Skullcandy SESH ANC',
    rating: 4.5,
    ratingCount: 72,
    criticalReviews: [{ reviewId: '1', rating: 1, title: 'Broke', text: 'Day two', verifiedPurchase: true }],
    criticalExpected: 7,
    deliveryPromiseDays: 2,
    deliveryText: 'Estimated between Fri, Oct 16 and Tue, Oct 20 to 10001',
    price: 16.34,
    currency: 'USD',
    ...overrides,
  };
}

test('maps a product onto the VentaWiz review body', () => {
  expect(toScrapedResult(q, product())).toEqual({
    store_id: 13,
    product_ids: [101, 102],
    rating: 4.5,
    rating_count: 72,
    critical_reviews: { reviews: [{ reviewId: '1', rating: 1, title: 'Broke', text: 'Day two', verifiedPurchase: true }] },
    aplus_content: null,
    delivery_promise_days: 2,
    epid: '17054784938',
    price: 16.34,
    currency: 'USD',
  });
});

test('a listing with no catalogue product posts nulls and an empty list, but keeps delivery', () => {
  const body = toScrapedResult(
    q,
    product({ epid: null, rating: null, ratingCount: null, criticalReviews: [], criticalExpected: null }),
  );
  expect(body).toMatchObject({
    rating: null,
    rating_count: null,
    critical_reviews: { reviews: [] },
    delivery_promise_days: 2,
    epid: null,
  });
});

test('toRating and toCount guard ranges and rounding', () => {
  expect(toRating(4.333, 10)).toBe(4.33);
  expect(toRating(5, 1)).toBe(5);
  expect(toRating(6, 1)).toBeNull();
  expect(toRating(0, 0)).toBeNull();
  expect(toRating(null, 1)).toBeNull();
  expect(toCount(3)).toBe(3);
  expect(toCount(-1)).toBeNull();
  expect(toCount(2.5)).toBeNull();
  expect(toCount(undefined)).toBeNull();
});
