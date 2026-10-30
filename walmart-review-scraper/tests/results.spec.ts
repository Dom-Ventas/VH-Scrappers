import { test, expect } from '@playwright/test';
import { toCount, toRating, toScrapedResult } from '../src/api/results';
import { ProductReviewResult, Query } from '../src/types';

const q: Query = { productIds: [101, 102], wpid: '243ESPUGUSOJ', shortCode: 'WMUS', storeId: 13 };

function product(overrides: Partial<ProductReviewResult> = {}): ProductReviewResult {
  return {
    wpid: '243ESPUGUSOJ',
    itemId: '11381374703',
    title: 'Apple AirPods 4',
    brand: 'Apple',
    rating: 4.3,
    ratingCount: 86071,
    criticalReviews: [{ rating: 1, title: 'Broke', text: 'Day two', verifiedPurchase: true }],
    criticalExpected: 600,
    deliveryPromiseDays: 1,
    deliveryText: 'SHIPPING: Tomorrow',
    price: 99,
    currency: 'USD',
    availability: 'IN_STOCK',
    ...overrides,
  };
}

test('maps a product onto the VentaWiz review body', () => {
  expect(toScrapedResult(q, product())).toEqual({
    store_id: 13,
    product_ids: [101, 102],
    rating: 4.3,
    rating_count: 86071,
    critical_reviews: { reviews: [{ rating: 1, title: 'Broke', text: 'Day two', verifiedPurchase: true }] },
    aplus_content: null,
    delivery_promise_days: 1,
    item_id: '11381374703',
    price: 99,
    currency: 'USD',
    availability: 'IN_STOCK',
  });
});

test('a product without ratings posts null, never 0', () => {
  const body = toScrapedResult(q, product({ rating: 0, ratingCount: 0, criticalReviews: [], deliveryPromiseDays: null }));
  expect(body.rating).toBeNull();
  expect(body.rating_count).toBe(0);
  expect(body.delivery_promise_days).toBeNull();
  expect(body.critical_reviews).toEqual({ reviews: [] });
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
