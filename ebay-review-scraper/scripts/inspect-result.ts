/**
 * Dev helper: scrape one product and dump what was extracted. Use this to
 * re-verify the page readers in src/extractors.ts after eBay changes
 * its product or review page.
 *
 *   npx tsx scripts/inspect-result.ts 265983500898
 *   npx tsx scripts/inspect-result.ts 278359701353 EBDE
 */
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { resolveMarketplace } from '../src/marketplaces';
import { scrapeProduct } from '../src/scraper';

async function main(): Promise<void> {
  const itemId = process.argv[2] || '265983500898';
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
    const product = await scrapeProduct(page, marketplace, itemId);
    const { criticalReviews, ...rest } = product;
    console.log(JSON.stringify({ ...rest, criticalReviews: criticalReviews.slice(0, 3) }, null, 2));
    console.log(`\n${criticalReviews.length} critical review(s) collected (first 3 shown); ratings: ` +
      `${criticalReviews.map((r) => r.rating).join(' ')}`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
