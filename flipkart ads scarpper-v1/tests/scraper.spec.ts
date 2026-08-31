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

// Flipkart PIDs look like "MOBGTAGPTB3VS24W" — uppercase alphanumeric, no
// fixed-prefix convention like Amazon's B-prefixed ASINs.
const PID_RE = /^[A-Z0-9]{10,}$/;

test('scrapeSearchTerm returns the expected number of products with the expected fields', async () => {
  const products = await scrapeSearchTerm(
    page,
    config.defaultFlipkartDomain,
    'bluetooth headphones',
  );

  console.table(
    products.map((p) => ({
      pos: p.position,
      pid: p.asin,
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

    expect(p.asin, `position ${p.position} pid`).toMatch(PID_RE);
    expect(typeof p.isSponsored).toBe('boolean');

    expect(p.title, `position ${p.position} title`).toBeTruthy();
    expect((p.title || '').length).toBeGreaterThan(3);

    expect(p.price, `position ${p.position} price`).toBeTruthy();
  }

  // At least one product should have a rating or review count populated
  // (can't assert on every row — some listings genuinely have no reviews).
  const withReviews = products.filter((p) => p.rating !== null || p.reviewCount !== null);
  expect(withReviews.length).toBeGreaterThan(0);

  // At least one card should be detected as a paid placement — Flipkart seeds
  // roughly a third of the first search page with sponsored products.
  expect(products.filter((p) => p.isSponsored).length).toBeGreaterThan(0);

  // NOTE: deliveryDays is expected to be null for every product right now —
  // Flipkart's search grid carries no delivery promise (see the comment on
  // SELECTORS.delivery). So this asserts only that whatever IS parsed is sane,
  // rather than requiring a non-null count the way the Amazon suite does.
  const withDays = products.filter((p) => p.deliveryDays !== null);
  for (const p of withDays) {
    // Sanity: Flipkart never promises yesterday, and we don't expect > 90 days out.
    expect(p.deliveryDays!).toBeGreaterThanOrEqual(0);
    expect(p.deliveryDays!).toBeLessThanOrEqual(90);
  }
});

test('scrapeSearchTerm handles a different query and still returns products', async () => {
  const products = await scrapeSearchTerm(
    page,
    config.defaultFlipkartDomain,
    'running shoes',
  );
  expect(products.length).toBe(config.topNResults);
  for (const p of products) {
    expect(p.asin).toMatch(PID_RE);
    expect(p.title).toBeTruthy();
  }
});
