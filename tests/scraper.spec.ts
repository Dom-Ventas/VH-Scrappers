import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import { config } from '../src/config';
import { scrapeSearchTerm } from '../src/scraper';

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(config.profileDir, {
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

test('scrapeSearchTerm returns 10 products with the expected fields', async () => {
  const products = await scrapeSearchTerm(
    page,
    config.defaultAmazonDomain,
    'bluetooth headphones',
  );

  console.table(
    products.map((p) => ({
      pos: p.position,
      asin: p.asin,
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

    expect(p.asin, `position ${p.position} asin`).toMatch(/^B[A-Z0-9]{9}$/);
    expect(typeof p.isSponsored).toBe('boolean');

    expect(p.title, `position ${p.position} title`).toBeTruthy();
    expect((p.title || '').length).toBeGreaterThan(3);

    expect(p.price, `position ${p.position} price`).toBeTruthy();
  }

  // At least one product should have a rating or review count populated
  // (can't assert on every row — some listings genuinely have no reviews).
  const withReviews = products.filter((p) => p.rating !== null || p.reviewCount !== null);
  expect(withReviews.length).toBeGreaterThan(0);

  // At least one product should have a parseable delivery-days number.
  const withDays = products.filter((p) => p.deliveryDays !== null);
  expect(withDays.length).toBeGreaterThan(0);
  for (const p of withDays) {
    // Sanity: Amazon never promises yesterday, and we don't expect > 90 days out.
    expect(p.deliveryDays!).toBeGreaterThanOrEqual(0);
    expect(p.deliveryDays!).toBeLessThanOrEqual(90);
  }
});

test('scrapeSearchTerm handles a different query and still returns 10 products', async () => {
  const products = await scrapeSearchTerm(page, config.defaultAmazonDomain, 'running shoes');
  expect(products.length).toBe(config.topNResults);
  for (const p of products) {
    expect(p.asin).toMatch(/^B[A-Z0-9]{9}$/);
    expect(p.title).toBeTruthy();
  }
});
