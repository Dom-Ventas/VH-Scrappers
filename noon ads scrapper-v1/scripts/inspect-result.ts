/**
 * Dev helper: scrape one search term and dump the extracted products, plus a
 * per-field fill-rate summary. Use this to re-verify SELECTORS in
 * src/extractors.ts after noon rotates its CSS-module hashes.
 *
 *   npx tsx scripts/inspect-result.ts "protein powder"
 *   npx tsx scripts/inspect-result.ts "protein powder" NNSA   # KSA storefront
 */
import { chromium } from 'playwright';
import { config } from '../src/config';
import { scrapeSearchTerm } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';
import { Product } from '../src/types';

async function main(): Promise<void> {
  const searchTerm = process.argv[2] || 'protein powder';
  const shortCode = process.argv[3] || 'NNAE';
  const marketplace = resolveMarketplace(shortCode);

  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    // See scripts/check-sponsored.ts — real Chrome by default so this can be
    // pointed at the production profile safely.
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : config.chromeChannel,
    viewport: null,
    args: [
      '--window-position=-32000,-32000',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const page = await context.newPage();
  try {
    const products = await scrapeSearchTerm(page, marketplace, searchTerm);
    console.log(JSON.stringify(products, null, 2));

    const filled = (k: keyof Product) =>
      products.filter((p) => p[k] !== null && p[k] !== '').length;
    console.log(
      `\nscraped ${products.length} cards from ${shortCode} (${marketplace.locale}); fill rate per field:`,
    );
    console.table({
      sku: filled('sku'),
      title: filled('title'),
      price: filled('price'),
      rating: filled('rating'),
      reviewCount: filled('reviewCount'),
      deliveryText: filled('deliveryText'),
      deliveryDays: filled('deliveryDays'),
      sponsored: products.filter((p) => p.isSponsored).length,
    });
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
