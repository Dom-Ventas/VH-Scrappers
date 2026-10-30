/**
 * Dev helper: scrape one search term and dump the extracted products, plus a
 * per-field fill-rate summary. Use this to re-verify SELECTORS in
 * src/extractors.ts after eBay changes its search page.
 *
 *   npx tsx scripts/inspect-result.ts "bluetooth headphones"
 *   npx tsx scripts/inspect-result.ts "bluetooth kopfhörer" EBDE
 */
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { resolveMarketplace } from '../src/marketplaces';
import { scrapeSearchTerm } from '../src/scraper';
import { Product } from '../src/types';

async function main(): Promise<void> {
  const searchTerm = process.argv[2] || 'bluetooth headphones';
  const shortCode = process.argv[3] || 'EBUS';
  const marketplace = resolveMarketplace(shortCode);

  const context = await launchChrome(config.profileDir, {
    headless: false,
    channel: config.chromeChannel,
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
    console.log(`\nscraped ${products.length} cards from ${shortCode} (${marketplace.url}); fill rate per field:`);
    console.table({
      itemId: filled('itemId'),
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
