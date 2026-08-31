import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import { config } from '../src/config';
import { scrapeSearchTerm } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';

let context: BrowserContext;
let page: Page;

const MARKETPLACE = resolveMarketplace(process.env.TEST_SHORT_CODE || 'NNAE');

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

// Noon issues two SKU shapes on the same results page — a catalogue id
// ("N70034197V") and a longer hex id ("Z38F7F87F384F17FD4824Z") — so this
// matches the character class and a minimum length rather than a fixed prefix.
const SKU_RE = /^[A-Z0-9]{8,}$/;

test('scrapeSearchTerm returns the expected number of products with the expected fields', async () => {
  const products = await scrapeSearchTerm(page, MARKETPLACE, 'protein powder');

  console.table(
    products.map((p) => ({
      pos: p.position,
      sku: p.sku,
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

    expect(p.sku, `position ${p.position} sku`).toMatch(SKU_RE);
    expect(typeof p.isSponsored).toBe('boolean');

    expect(p.title, `position ${p.position} title`).toBeTruthy();
    expect((p.title || '').length).toBeGreaterThan(3);

    expect(p.price, `position ${p.position} price`).toBeTruthy();
    // Price carries the storefront currency code, e.g. "AED 165.30".
    expect(p.price, `position ${p.position} price`).toContain(MARKETPLACE.currency);
  }

  // At least one product should have a rating or review count populated
  // (can't assert on every row — some listings genuinely have no reviews).
  const withReviews = products.filter((p) => p.rating !== null || p.reviewCount !== null);
  expect(withReviews.length).toBeGreaterThan(0);

  // Unlike Flipkart — whose grid ships no delivery promise at all, leaving both
  // fields permanently null — noon renders the promise on the card, so this
  // asserts real data rather than only sanity-checking it.
  const withDelivery = products.filter((p) => p.deliveryText);
  expect(withDelivery.length).toBeGreaterThan(0);

  for (const p of products.filter((x) => x.deliveryDays !== null)) {
    // Sanity: noon never promises yesterday, and we don't expect > 90 days out.
    expect(p.deliveryDays!).toBeGreaterThanOrEqual(0);
    expect(p.deliveryDays!).toBeLessThanOrEqual(90);
  }

  // Noon seeds a consistent minority of the first page with paid placements —
  // 9 of the top 20 on every uae-en query measured. Assert BOTH bounds: zero
  // means the "Ad" badge markup moved (it is an inline SVG with no text, so it
  // fails silently), and all-20 means a selector went broad and is flagging
  // organic cards. The Flipkart suite only checks the lower bound; the upper
  // one is what catches the match-everything failure mode.
  const sponsored = products.filter((p) => p.isSponsored);
  expect(sponsored.length).toBeGreaterThan(0);
  expect(sponsored.length).toBeLessThan(products.length);
});

test('scrapeSearchTerm handles a different query and still returns products', async () => {
  const products = await scrapeSearchTerm(page, MARKETPLACE, 'bluetooth headphones');
  expect(products.length).toBe(config.topNResults);
  for (const p of products) {
    expect(p.sku).toMatch(SKU_RE);
    expect(p.title).toBeTruthy();
  }
});
