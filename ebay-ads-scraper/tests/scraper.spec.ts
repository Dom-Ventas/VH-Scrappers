import { test, expect, BrowserContext, Page } from '@playwright/test';
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { scrapeSearchTerm } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';

/**
 * Live test against eBay. Run it on a profile whose "Shipping to" is set to
 * the marketplace's country (SCRAPER_PROFILE_DIR=.dev-profile after a dev-api
 * run, or the real profile after first-run) — shipped to another country,
 * eBay hides most domestic listings and every term looks different.
 */

let context: BrowserContext;
let page: Page;

const MARKETPLACE = resolveMarketplace(process.env.TEST_SHORT_CODE || 'EBUS');

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

// eBay item numbers are 12 digits today; allow 9-15.
const ITEM_ID_RE = /^\d{9,15}$/;
// Prices are normalised to "<ISO currency> <amount>", e.g. "USD 15.49".
const PRICE_RE = /^[A-Z]{3} \d+\.\d{2}$/;

test('scrapeSearchTerm returns the expected number of products with the expected fields', async () => {
  const products = await scrapeSearchTerm(page, MARKETPLACE, 'bluetooth headphones');

  console.table(
    products.map((p) => ({
      pos: p.position,
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

    expect(p.itemId, `position ${p.position} itemId`).toMatch(ITEM_ID_RE);
    expect(typeof p.isSponsored).toBe('boolean');

    expect(p.title, `position ${p.position} title`).toBeTruthy();
    expect(p.title, `position ${p.position} title`).not.toMatch(/opens in a new window/i);

    expect(p.price, `position ${p.position} price`).toMatch(PRICE_RE);
    expect(p.price, `position ${p.position} price`).toContain(MARKETPLACE.currency);

    if (p.rating !== null) {
      expect(p.rating).toBeGreaterThanOrEqual(0);
      expect(p.rating).toBeLessThanOrEqual(5);
    }
    if (p.deliveryDays !== null) {
      expect(p.deliveryDays).toBeGreaterThanOrEqual(0);
      expect(p.deliveryDays).toBeLessThanOrEqual(90);
    }
  }

  // Item numbers are unique on a page.
  expect(new Set(products.map((p) => p.itemId)).size).toBe(products.length);

  // eBay seeds a third or so of the first page with Promoted Listings (7-10
  // of the top 20 when verified). Assert BOTH bounds: zero means the label
  // check broke, and all-20 means the decoy label on organic cards is being
  // read as a real one.
  const sponsored = products.filter((p) => p.isSponsored);
  expect(sponsored.length).toBeGreaterThan(0);
  expect(sponsored.length).toBeLessThan(products.length);
});

test('scrapeSearchTerm handles a different query and still returns products', async () => {
  const products = await scrapeSearchTerm(page, MARKETPLACE, 'yoga mat');
  expect(products.length).toBe(config.topNResults);
  for (const p of products) {
    expect(p.itemId).toMatch(ITEM_ID_RE);
    expect(p.title).toBeTruthy();
  }
});
