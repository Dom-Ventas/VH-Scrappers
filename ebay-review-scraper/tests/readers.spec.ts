import { test, expect } from '@playwright/test';
import { chromium, Browser, Page } from 'playwright';
import { readListingPage, readReviewsPage } from '../src/extractors';

/**
 * Offline check of the page readers against eBay's markup as captured from
 * www.ebay.com / www.ebay.de on 2026-10-14, trimmed to the parts read.
 * Runs in installed Chrome; no network.
 */

const LISTING = `<!doctype html><html><body>
  <h1 class="x-item-title__mainTitle"><span class="ux-textspans ux-textspans--BOLD">Skullcandy SESH ANC Wireless In-ear Bluetooth Earbuds</span></h1>
  <div class="x-price-primary"><span class="ux-textspans">US $16.34</span></div>
  <div class="ux-labels-values ux-labels-values--shipping"><div class="ux-labels-values__values"><span>Free 2-4 day delivery</span></div></div>
  <div class="ux-labels-values ux-labels-values--deliverto"><div class="ux-labels-values__values"><div>
    <span class="ux-textspans">Estimated between </span><span class="ux-textspans ux-textspans--BOLD">Fri, Oct 16</span>
    <span class="ux-textspans"> and </span><span class="ux-textspans ux-textspans--BOLD">Tue, Oct 20</span><span> to </span><span>10001</span></div></div></div>
  <a href="https://www.ebay.com/help/selling/listings/product-reviews?id=5186">Learn more</a>
  <a href="https://www.ebay.com/urw/Other-Product/product-reviews/111111111?_itm=999999999999">another listing's product</a>
  <a href="https://www.ebay.com/urw/Skullcandy+Sesh/product-reviews/17054784938?_itm=265983500898">See all 72 reviews</a>
</body></html>`;

const NO_CATALOGUE = `<!doctype html><html><body>
  <h1 class="x-item-title__mainTitle"><span>Bluetooth Earphones</span></h1>
  <div class="ux-labels-values ux-labels-values--shipping"><div class="ux-labels-values__values">
    <span>Free 2-4 day delivery</span> <span>Get it between Fri, Oct 16 and Mon, Oct 19</span> <span>to</span> <span>10001</span></div></div>
</body></html>`;

const MISSING = `<!doctype html><html><head><title>Discover | eBay</title></head><body>
  <p>We looked everywhere!</p><p>Looks like this page is missing. If you still need help, visit our help pages.</p>
</body></html>`;

function review(id: string, rating: number, type: string, attrs: string): string {
  return `<div data-type="${type}" class=" ebay-review-section" id="review_${id}" itemprop="review" itemscope itemtype="https://schema.org/Review">
    <div class="ebay-review-section-l"><div class="ebay-star-rating" itemprop="reviewRating" itemscope itemtype="https://schema.org/Rating">
      <meta itemprop="ratingValue" content="${rating}"></div>
      <a href="https://www.ebay.com/usr/u${id}" class="review-item-author" itemprop="author">u${id}</a>
      <span itemprop="datePublished" content="Jun 05, 2023" class="review-item-date">Jun 05, 2023</span></div>
    <div class="ebay-review-section-r"><h3 itemprop="name" class="review-item-title">Title ${id}</h3>
      <p itemprop="reviewBody" class="review-item-content">Body ${id}</p>
      <p class="review-attr">${attrs}</p></div></div>`;
}

const REVIEWS = `<!doctype html><html><body>
  <div id="histogramSection"><div class="ebay-content-wrapper" itemprop="aggregateRating" itemscope itemtype="https://schema.org/AggregateRating">
    <span class="ebay-review-start-rating">4,7<span class="clipped">4,7 von 5 Sternen</span></span>
    <meta itemprop="ratingValue" content="4.7"><meta itemprop="reviewCount" content="154"></div>
    <ul class="ebay-review-list">
      <li class="ebay-review-item"><p class="ebay-review-item-stars">5<span class="clipped">Sterne</span></p><div class="ebay-review-item-c"><span>130</span></div></li>
      <li class="ebay-review-item"><p class="ebay-review-item-stars">4<span class="clipped">Sterne</span></p><div class="ebay-review-item-c"><span>11</span></div></li>
      <li class="ebay-review-item"><p class="ebay-review-item-stars">3<span class="clipped">Sterne</span></p><div class="ebay-review-item-c"><span>6</span></div></li>
      <li class="ebay-review-item"><p class="ebay-review-item-stars">2<span class="clipped">Sterne</span></p><div class="ebay-review-item-c"><span>2</span></div></li>
      <li class="ebay-review-item"><p class="ebay-review-item-stars">1<span class="clipped">Stern</span></p><div class="ebay-review-item-c"><span>5</span></div></li>
    </ul></div>
  ${review('1', 3, 'critical', 'Bestätigter Kauf:&nbsp; Ja • Artikelzustand:&nbsp;neu')}
  ${review('2', 1, 'undefined', 'Bestätigter Kauf:&nbsp; Ja • Artikelzustand:&nbsp;gebraucht')}
  ${review('3', 2, 'undefined', 'Artikelzustand:&nbsp;neu')}
  <a href="https://www.ebay.de/urw/product-reviews/22054478105?_itm=278359701353&sort=%2Brating&pgn=2">2</a>
</body></html>`;

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
});

test.afterAll(async () => {
  await browser?.close();
});

test('listing: title, price, Delivery row and this listing\'s own catalogue link', async () => {
  await page.setContent(LISTING);
  expect(await readListingPage(page, '265983500898')).toEqual({
    title: 'Skullcandy SESH ANC Wireless In-ear Bluetooth Earbuds',
    epid: '17054784938',
    deliveryText: 'Estimated between Fri, Oct 16 and Tue, Oct 20 to 10001',
    priceText: 'US $16.34',
    notFound: false,
  });
});

test('listing without a catalogue product falls back to the Shipping row', async () => {
  await page.setContent(NO_CATALOGUE);
  const data = await readListingPage(page, '405662453606');
  expect(data.epid).toBeNull();
  expect(data.deliveryText).toContain('Get it between Fri, Oct 16 and Mon, Oct 19');
});

test('missing listing is reported as not found', async () => {
  await page.setContent(MISSING);
  expect((await readListingPage(page, '999999999999')).notFound).toBe(true);
});

test('reviews page: aggregate, histogram, reviews, pinned flag, German verified, next page', async () => {
  await page.setContent(REVIEWS);
  const data = await readReviewsPage(page, 1);
  expect(data.rating).toBe(4.7);
  expect(data.ratingCount).toBe(154);
  expect(data.histogram).toEqual({ '1': 5, '2': 2, '3': 6, '4': 11, '5': 130 });
  expect(data.hasNext).toBe(true);
  expect(data.reviews.map((r) => [r.id, r.rating, r.pinned, r.verified])).toEqual([
    ['1', 3, true, true],
    ['2', 1, false, true],
    ['3', 2, false, false],
  ]);
  expect(data.reviews[1]).toMatchObject({ title: 'Title 2', text: 'Body 2', author: 'u2', date: 'Jun 05, 2023' });
  expect((await readReviewsPage(page, 2)).hasNext).toBe(false);
});
