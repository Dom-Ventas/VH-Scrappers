import { test, expect, BrowserContext, Page } from '@playwright/test';
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { scrapeProduct } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';
import { PermanentError } from '../src/util';

/**
 * Live test against www.ebay.com. Run it on a profile whose "Shipping to" is
 * set to the US (SCRAPER_PROFILE_DIR=../ebay-ads-scraper/.dev-profile after a
 * dev-api run there, or the real profile after first-run).
 */

let context: BrowserContext;
let page: Page;

const US = resolveMarketplace('EBUS');

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

test.setTimeout(240_000);

test('a catalogue-matched listing yields rating, count, delivery and every 1-2 star review', async () => {
  // Skullcandy Sesh ANC — 72 product ratings, 4 one-star + 3 two-star when verified.
  const product = await scrapeProduct(page, US, '265983500898');

  expect(product.epid).toMatch(/^\d+$/);
  expect(product.title).toContain('Skullcandy');
  expect(product.rating).toBeGreaterThan(0);
  expect(product.rating).toBeLessThanOrEqual(5);
  expect(product.ratingCount).toBeGreaterThan(10);
  expect(product.deliveryPromiseDays).not.toBeNull();
  expect(product.deliveryPromiseDays!).toBeGreaterThanOrEqual(0);
  expect(product.deliveryPromiseDays!).toBeLessThanOrEqual(30);

  expect(product.criticalExpected).not.toBeNull();
  expect(product.criticalReviews.length).toBe(Math.min(product.criticalExpected!, config.maxCriticalReviews));
  for (const r of product.criticalReviews) {
    expect(r.rating).toBeGreaterThanOrEqual(1);
    expect(r.rating).toBeLessThanOrEqual(2);
    expect(r.text || r.title).toBeTruthy();
  }
  expect(new Set(product.criticalReviews.map((r) => r.reviewId)).size).toBe(product.criticalReviews.length);
});

test('a listing without a catalogue product posts no rating but keeps delivery', async () => {
  const product = await scrapeProduct(page, US, '405662453606');
  expect(product.epid).toBeNull();
  expect(product.rating).toBeNull();
  expect(product.ratingCount).toBeNull();
  expect(product.criticalReviews).toEqual([]);
  expect(product.deliveryText).toBeTruthy();
});

test('an unknown item number is a permanent failure', async () => {
  await expect(scrapeProduct(page, US, '999999999999')).rejects.toBeInstanceOf(PermanentError);
});
