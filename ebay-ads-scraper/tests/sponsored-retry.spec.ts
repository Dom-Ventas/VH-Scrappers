import { test, expect } from '@playwright/test';
import type { Locator } from 'playwright';
import { retrySponsoredDetection } from '../src/scraper';
import { Product } from '../src/types';

/**
 * The retry pass calls its detector per card; the cards here are opaque
 * tokens and the detector reads the `ad` flag off them.
 */
function fakeCards(ads: boolean[]): Locator {
  return { nth: (i: number) => ({ ad: ads[i] }) } as unknown as Locator;
}

function product(i: number, overrides: Partial<Product> = {}): Product {
  return {
    position: i + 1,
    itemId: `${400000000000 + i}`,
    isSponsored: false,
    title: `t${i}`,
    price: 'USD 1.00',
    rating: null,
    reviewCount: null,
    deliveryText: null,
    deliveryDays: null,
    ...overrides,
  };
}

const detect = async (card: Locator) => (card as unknown as { ad: boolean }).ad;

test('no retry when the first pass already found an ad', async () => {
  const products = [product(0, { isSponsored: true }), product(1)];
  const n = await retrySponsoredDetection(fakeCards([true, true]), products, 'x', detect);
  expect(n).toBe(1);
  expect(products.map((p) => p.isSponsored)).toEqual([true, false]);
});

test('retry flips the cards that now show a painted label', async () => {
  const products = [product(0), product(1), product(2)];
  const n = await retrySponsoredDetection(fakeCards([true, false, true]), products, 'x', detect);
  expect(n).toBe(2);
  expect(products.map((p) => p.isSponsored)).toEqual([true, false, true]);
});

test('cards without an item number are skipped on retry', async () => {
  const products = [product(0, { itemId: null }), product(1)];
  const n = await retrySponsoredDetection(fakeCards([true, false]), products, 'x', detect);
  expect(n).toBe(0);
  expect(products[0].isSponsored).toBe(false);
});

test('still-zero result leaves products organic and says so', async () => {
  const products = [product(0), product(1)];
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  try {
    const n = await retrySponsoredDetection(fakeCards([false, false]), products, 'niche', detect);
    expect(n).toBe(0);
  } finally {
    console.warn = orig;
  }
  expect(products.every((p) => !p.isSponsored)).toBe(true);
  expect(warnings[warnings.length - 1]).toContain('still 0 sponsored');
});

test('empty product list is a no-op', async () => {
  const n = await retrySponsoredDetection(fakeCards([]), [], 'x', detect);
  expect(n).toBe(0);
});
