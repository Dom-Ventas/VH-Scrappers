import { test, expect } from '@playwright/test';
import { toResultProducts } from '../src/api/results';
import { Product } from '../src/types';

function product(position: number, overrides: Partial<Product> = {}): Product {
  return {
    position,
    itemId: `${400000000000 + position}`,
    isSponsored: false,
    title: `t${position}`,
    price: 'USD 10.00',
    rating: 4.5,
    reviewCount: 10,
    deliveryText: 'Free delivery in 2-3 days',
    deliveryDays: 2,
    ...overrides,
  };
}

test('keeps at most five sponsored and five organic, in page order', () => {
  const pool = Array.from({ length: 20 }, (_, i) => product(i + 1, { isSponsored: i % 3 === 0 }));
  const out = toResultProducts(pool);
  expect(out.filter((p) => p.is_sponsored).map((p) => p.position)).toEqual([1, 4, 7, 10, 13]);
  expect(out.filter((p) => !p.is_sponsored).map((p) => p.position)).toEqual([2, 3, 5, 6, 8]);
  expect(out.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 13]);
});

test('drops cards without an item number and maps the VentaWiz field names', () => {
  const out = toResultProducts([product(1, { itemId: null }), product(2, { isSponsored: true })]);
  expect(out).toEqual([
    {
      position: 2,
      mp_product_id: '400000000002',
      is_sponsored: true,
      price: 'USD 10.00',
      rating: 4.5,
      review_count: 10,
      delivery_days: 2,
      title: 't2',
    },
  ]);
});

test('out-of-range values become null, never 0 or -1', () => {
  const [p] = toResultProducts([
    product(1, { rating: 7, reviewCount: -1, deliveryDays: -2, price: '', title: '' }),
  ]);
  expect(p).toMatchObject({ rating: null, review_count: null, delivery_days: null, price: null, title: null });
});

test('an empty scrape posts an empty list', () => {
  expect(toResultProducts([])).toEqual([]);
});
