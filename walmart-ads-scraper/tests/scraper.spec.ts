import { test, expect, BrowserContext, Page } from '@playwright/test';
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { scrapeSearchTerm } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';

let context: BrowserContext;
let page: Page;

const MARKETPLACE = resolveMarketplace(process.env.TEST_SHORT_CODE || 'WMUS');

test.beforeAll(async () => {
  context = await launchChrome(config.profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

// Walmart item ids are numeric, 6+ digits ("432112771", "11381374703");
// wpids are upper-case alphanumeric ("243ESPUGUSOJ").
const ITEM_ID_RE = /^\d{6,}$/;
const WPID_RE = /^(?=.*[A-Z])[A-Z0-9]{8,20}$/;
// Prices are normalised to "<ISO currency> <amount>", e.g. "USD 363.00".
const PRICE_RE = /^[A-Z]{3} \d+\.\d{2}$/;

test('scrapeSearchTerm returns the expected number of products with the expected fields', async () => {
  const products = await scrapeSearchTerm(page, MARKETPLACE, 'bluetooth headphones');

  console.table(
    products.map((p) => ({
      pos: p.position,
      wpid: p.wpid,
      itemId: p.itemId,
      sponsored: p.isSponsored,
      title: (p.title || '').slice(0, 50),
      price: p.price,
      rating: p.rating,
      reviews: p.reviewCount,
      days: p.deliveryDays,
      delivery: (p.deliveryText || '').slice(0, 30),
    })),
  );

  expect(products.length).toBe(config.topNResults);

  for (const p of products) {
    expect(p.position).toBeGreaterThanOrEqual(1);
    expect(p.position).toBeLessThanOrEqual(config.topNResults);

    expect(p.wpid, `position ${p.position} wpid`).toMatch(WPID_RE);
    expect(p.itemId, `position ${p.position} itemId`).toMatch(ITEM_ID_RE);
    expect(typeof p.isSponsored).toBe('boolean');

    expect(p.title, `position ${p.position} title`).toBeTruthy();
    expect((p.title || '').length).toBeGreaterThan(3);

    expect(p.price, `position ${p.position} price`).toMatch(PRICE_RE);
    expect(p.price, `position ${p.position} price`).toContain(MARKETPLACE.currency);

    if (p.rating !== null) {
      expect(p.rating).toBeGreaterThanOrEqual(0);
      expect(p.rating).toBeLessThanOrEqual(5);
    }
  }

  // At least one product should have a rating or review count populated
  // (can't assert on every row — some listings genuinely have no reviews).
  const withReviews = products.filter((p) => p.rating !== null || p.reviewCount !== null);
  expect(withReviews.length).toBeGreaterThan(0);

  // Walmart prints the delivery promise on the tile, so — unlike Flipkart —
  // most products should resolve to a day count.
  const withDays = products.filter((p) => p.deliveryDays !== null);
  expect(withDays.length).toBeGreaterThan(0);
  for (const p of withDays) {
    expect(p.deliveryDays!).toBeGreaterThanOrEqual(0);
    expect(p.deliveryDays!).toBeLessThanOrEqual(90);
  }

  // Walmart seeds a minority of the first page with paid placements (12 of 52
  // on this term when verified). Assert BOTH bounds: zero means the
  // "Sponsored" markup moved, and all-20 means a signal went broad.
  const sponsored = products.filter((p) => p.isSponsored);
  expect(sponsored.length).toBeGreaterThan(0);
  expect(sponsored.length).toBeLessThan(products.length);
});

test('scrapeSearchTerm handles a different query and still returns products', async () => {
  const products = await scrapeSearchTerm(page, MARKETPLACE, 'air fryer');
  expect(products.length).toBe(config.topNResults);
  for (const p of products) {
    expect(p.wpid).toMatch(WPID_RE);
    expect(p.title).toBeTruthy();
  }
});
