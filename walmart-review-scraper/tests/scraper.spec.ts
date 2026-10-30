import { test, expect, BrowserContext, Page } from '@playwright/test';
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { scrapeProduct } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';
import { PermanentError } from '../src/util';

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

test.setTimeout(240_000);

test('scrapeProduct reads rating, count, delivery and critical reviews for a well-reviewed product', async () => {
  // Apple AirPods 4 — tens of thousands of ratings, thousands of 1-2 star reviews.
  const product = await scrapeProduct(page, MARKETPLACE, '243ESPUGUSOJ');

  expect(product.itemId).toMatch(/^\d{6,}$/);
  expect(product.title).toContain('AirPods');
  expect(product.rating).toBeGreaterThan(0);
  expect(product.rating).toBeLessThanOrEqual(5);
  expect(product.ratingCount).toBeGreaterThan(1000);
  expect(product.deliveryPromiseDays).not.toBeNull();
  expect(product.deliveryPromiseDays!).toBeGreaterThanOrEqual(0);
  expect(product.deliveryPromiseDays!).toBeLessThanOrEqual(30);

  expect(product.criticalReviews.length).toBeGreaterThan(0);
  expect(product.criticalReviews.length).toBeLessThanOrEqual(config.maxCriticalReviews);
  for (const r of product.criticalReviews) {
    expect(r.rating).toBeGreaterThanOrEqual(1);
    expect(r.rating).toBeLessThanOrEqual(2);
    expect((r.text || r.title || '').length).toBeGreaterThan(0);
  }
});

test('an unknown wpid is a permanent failure', async () => {
  await expect(scrapeProduct(page, MARKETPLACE, 'ZZZZZZZZZZZZ')).rejects.toBeInstanceOf(PermanentError);
});
