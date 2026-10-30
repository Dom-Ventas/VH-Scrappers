import { test, expect } from '@playwright/test';
import type { Locator } from 'playwright';
import { retrySponsoredDetection } from '../src/scraper';
import { Product } from '../src/types';

/**
 * Fake `div[data-id]` card list. Each entry says whether the sponsored
 * selectors match on the retry pass and what the card's own tracking id is.
 * `count()` is what hasAnySponsored() calls; `getAttribute()` feeds the
 * diagnostic line. Everything else on Locator is unused here.
 */
function fakeCards(spec: { sponsored: boolean; tkid: string }[]): Locator {
  const card = (s: { sponsored: boolean; tkid: string }): Locator =>
    ({
      locator: () =>
        ({
          count: async () => (s.sponsored ? 1 : 0),
          first: () => ({ getAttribute: async () => s.tkid }),
        }) as unknown as Locator,
    }) as unknown as Locator;
  return { nth: (i: number) => card(spec[i]) } as unknown as Locator;
}

function product(i: number, overrides: Partial<Product> = {}): Product {
  return {
    position: i + 1,
    asin: `PID${i}`,
    isSponsored: false,
    title: `t${i}`,
    price: '₹1',
    rating: null,
    reviewCount: null,
    deliveryText: null,
    deliveryDays: null,
    ...overrides,
  };
}

test('no retry when the first pass already found an ad', async () => {
  const products = [product(0, { isSponsored: true }), product(1)];
  // Cards would report sponsored, but must never be consulted.
  const cards = fakeCards([
    { sponsored: true, tkid: 'en_a' },
    { sponsored: true, tkid: 'en_b' },
  ]);
  const n = await retrySponsoredDetection(cards, products, 'x');
  expect(n).toBe(1);
  expect(products.map((p) => p.isSponsored)).toEqual([true, false]);
});

test('retry flips late-attached ad markup to sponsored', async () => {
  const products = [product(0), product(1), product(2)];
  const cards = fakeCards([
    { sponsored: true, tkid: 'en_a' },
    { sponsored: false, tkid: 'uuid-1' },
    { sponsored: true, tkid: 'en_c' },
  ]);
  const n = await retrySponsoredDetection(cards, products, 'x');
  expect(n).toBe(2);
  expect(products.map((p) => p.isSponsored)).toEqual([true, false, true]);
});

test('cards without a PID are skipped on retry', async () => {
  const products = [product(0, { asin: null }), product(1)];
  const cards = fakeCards([
    { sponsored: true, tkid: 'en_a' },
    { sponsored: false, tkid: 'uuid' },
  ]);
  const n = await retrySponsoredDetection(cards, products, 'x');
  expect(n).toBe(0);
  expect(products[0].isSponsored).toBe(false);
});

test('still-zero result logs tkid prefixes and leaves products organic', async () => {
  const products = [product(0), product(1)];
  const cards = fakeCards([
    { sponsored: false, tkid: '15272b35-f3dc' },
    { sponsored: false, tkid: 'en_qf2MDa7J' },
  ]);
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  try {
    const n = await retrySponsoredDetection(cards, products, 'boat');
    expect(n).toBe(0);
  } finally {
    console.warn = orig;
  }
  expect(products.every((p) => !p.isSponsored)).toBe(true);
  const last = warnings[warnings.length - 1];
  expect(last).toContain('still 0 sponsored');
  expect(last).toContain('1:15272b35');
  expect(last).toContain('2:en_qf2MD');
});

test('empty product list is a no-op', async () => {
  const n = await retrySponsoredDetection(fakeCards([]), [], 'x');
  expect(n).toBe(0);
});
