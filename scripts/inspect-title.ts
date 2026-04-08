import { chromium } from 'playwright';
import { config } from '../src/config';

async function main() {
  const ctx = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
  });
  const page = await ctx.newPage();
  await page.goto('https://www.amazon.in/s?k=running+shoes', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('div[data-component-type="s-search-result"]');
  const cards = page.locator('div[data-component-type="s-search-result"]');
  for (let i = 0; i < 5; i++) {
    const card = cards.nth(i);
    const info = await card.evaluate((el: Element) => ({
      asin: el.getAttribute('data-asin'),
      h2Text: (el.querySelector('h2') as HTMLElement | null)?.innerText?.trim() || null,
      imgAlt: (el.querySelector('img.s-image') as HTMLImageElement | null)?.alt || null,
      imgAltAny: (el.querySelector('img[alt]') as HTMLImageElement | null)?.alt || null,
    }));
    console.log(`card ${i + 1}:`, JSON.stringify(info));
  }
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
