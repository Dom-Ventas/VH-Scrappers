import { test, expect } from '@playwright/test';
import type { Locator } from 'playwright';
import { retrySponsoredDetection } from '../src/scraper';
import { Product } from '../src/types';

/**
 * Fake tile list. Each entry says whether the "Sponsored" tag is present on the
 * retry pass and what the main link's href is. `locator().count()` is what the
 * tag/text signals call; `locator().first().getAttribute()` is the href read.
 */
function fakeCards(spec: { tag: boolean; href: string }[]): Locator {
  const card = (s: { tag: boolean; href: string }): Locator =>
    ({
      locator: () =>
        ({
          count: async () => (s.tag ? 1 : 0),
          first: () => ({ count: async () => 1, getAttribute: async () => s.href }),
        }) as unknown as Locator,
    }) as unknown as Locator;
  return { nth: (i: number) => card(spec[i]) } as unknown as Locator;
}

function product(i: number, overrides: Partial<Product> = {}): Product {
  return {
    position: i + 1,
    wpid: `WP${i}ABCDEFGH`,
    itemId: `${1000 + i}`,
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

test('no retry when the first pass already found an ad', async () => {
  const products = [product(0, { isSponsored: true }), product(1)];
  const cards = fakeCards([
    { tag: true, href: '/sp/track?x' },
    { tag: true, href: '/sp/track?x' },
  ]);
  const n = await retrySponsoredDetection(cards, products, 'x');
  expect(n).toBe(1);
  expect(products.map((p) => p.isSponsored)).toEqual([true, false]);
});

test('retry flips a tile to sponsored on either signal', async () => {
  const products = [product(0), product(1), product(2)];
  const cards = fakeCards([
    { tag: true, href: '/ip/a/1' }, // tag only
    { tag: false, href: '/ip/b/2' },
    { tag: false, href: 'https://www.walmart.com/sp/track?bt=1' }, // ad href only
  ]);
  const n = await retrySponsoredDetection(cards, products, 'x');
  expect(n).toBe(2);
  expect(products.map((p) => p.isSponsored)).toEqual([true, false, true]);
});

test('cards without an id are skipped on retry', async () => {
  const products = [product(0, { wpid: null }), product(1)];
  const cards = fakeCards([
    { tag: true, href: '/sp/track?x' },
    { tag: false, href: '/ip/b/2' },
  ]);
  const n = await retrySponsoredDetection(cards, products, 'x');
  expect(n).toBe(0);
  expect(products[0].isSponsored).toBe(false);
});

test('still-zero result leaves products organic and says so', async () => {
  const products = [product(0), product(1)];
  const cards = fakeCards([
    { tag: false, href: '/ip/a/1' },
    { tag: false, href: '/ip/b/2' },
  ]);
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
  try {
    const n = await retrySponsoredDetection(cards, products, 'niche');
    expect(n).toBe(0);
  } finally {
    console.warn = orig;
  }
  expect(products.every((p) => !p.isSponsored)).toBe(true);
  expect(warnings[warnings.length - 1]).toContain('still 0 sponsored');
});

test('empty product list is a no-op', async () => {
  const n = await retrySponsoredDetection(fakeCards([]), [], 'x');
  expect(n).toBe(0);
});
