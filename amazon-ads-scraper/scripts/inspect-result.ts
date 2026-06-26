import { chromium } from 'playwright';
import { config } from '../src/config';

async function main() {
  const ctx = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
  });
  const page = await ctx.newPage();
  await page.goto('https://www.amazon.in/s?k=bluetooth+headphones', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('div[data-component-type="s-search-result"]');
  const firstCard = page.locator('div[data-component-type="s-search-result"]').first();

  const html = await firstCard.evaluate((el: Element) => {
    // Only log the rating / review area
    const anchors = Array.from(el.querySelectorAll('a[href*="customerReviews"], a[href*="#customerReviews"]'));
    return anchors.map((a) => (a as HTMLElement).outerHTML).join('\n---\n');
  });
  console.log('--- customerReviews anchors ---');
  console.log(html);

  const ratingRow = await firstCard.evaluate((el: Element) => {
    const row = el.querySelector('[data-cy="reviews-block"]') || el.querySelector('.a-row.a-size-small');
    return row ? (row as HTMLElement).outerHTML : '(none)';
  });
  console.log('--- reviews block ---');
  console.log(ratingRow);

  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
