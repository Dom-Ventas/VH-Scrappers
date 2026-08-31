import { Page } from 'playwright';
import { config } from './config';
import { Product } from './types';
import { MarketplaceConfig } from './marketplaces';
import { extractProduct, SELECTORS } from './extractors';
import { sleep } from './util';

function buildSearchUrl(marketplace: MarketplaceConfig, searchTerm: string): string {
  const cleanDomain = marketplace.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const q = encodeURIComponent(searchTerm.trim());
  // Noon scopes every route by storefront (`uae-en`, `saudi-en`, ...) in the
  // first path segment — there is no per-country host and no cookie override,
  // so the locale has to be in the URL or you silently get another country's
  // catalogue. `limit=50` pins the page size so the top-20 slice is stable
  // regardless of the viewport noon infers.
  return `https://${cleanDomain}/${marketplace.locale}/search/?q=${q}&limit=50`;
}

/**
 * Noon drops interstitials over the grid on the first navigation of a session —
 * a country/language picker, an app-install banner and a notifications prompt.
 * They swallow clicks and can cover the lower half of the results, so dismiss
 * them before extracting. No-op once the user has dismissed them in the
 * persistent profile, which is the normal steady state.
 */
async function dismissOverlays(page: Page): Promise<void> {
  const closeButtons = [
    '[data-qa="close-modal"]',
    '[data-qa*="close" i]',
    'button[aria-label="Close" i]',
    'div[class*="_modal_"] button[class*="_close_"]',
    'button:has-text("Not now")',
    'button:has-text("Maybe later")',
  ];
  for (const sel of closeButtons) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 2_000 });
        return;
      }
    } catch {
      // try the next candidate
    }
  }
}

export async function scrapeSearchTerm(
  page: Page,
  marketplace: MarketplaceConfig,
  searchTerm: string,
): Promise<Product[]> {
  const url = buildSearchUrl(marketplace, searchTerm);
  console.log(`[SCRAPE] GET ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);

  try {
    await page.waitForSelector(SELECTORS.resultCard, {
      timeout: config.resultsWaitTimeoutMs,
    });
  } catch {
    throw new Error(
      `No search results loaded for "${searchTerm}" (possible CAPTCHA or block page).`,
    );
  }

  // Noon lazy-mounts the delivery/rating strip on tiles below the fold.
  // A couple of page-downs materialises the top ~24 cards fully.
  for (let s = 0; s < 3; s++) {
    await page.mouse.wheel(0, 1200);
    await sleep(400);
  }

  const cards = page.locator(SELECTORS.resultCard);
  const total = await cards.count();
  const take = Math.min(total, config.topNResults);

  const products: Product[] = [];
  for (let i = 0; i < take; i++) {
    try {
      const product = await extractProduct(cards.nth(i), i + 1, marketplace.currency);
      products.push(product);
    } catch (err) {
      console.warn(`[SCRAPE] Failed to extract product at position ${i + 1}:`, err);
      products.push({
        position: i + 1,
        sku: null,
        isSponsored: false,
        title: null,
        price: null,
        rating: null,
        reviewCount: null,
        deliveryText: null,
        deliveryDays: null,
      });
    }
  }

  // Guard against the classic ad-detector failure: a selector that matches
  // every card. Noon's real ad load is a minority of the grid (a consistent
  // 9 of 20 across five queries), so a 100% sponsored page means a selector in
  // SELECTORS.sponsoredBadge went broad — most likely the structural
  // `_overlayFooter_ svg` backstop catching a newly-added inline-SVG icon.
  // Warn rather than silently posting a page of false positives; the data is
  // still returned so the caller can see it.
  if (products.length > 1 && products.every((p) => p.isSponsored)) {
    console.warn(
      `[SCRAPE] SUSPECT: all ${products.length} cards flagged sponsored for "${searchTerm}". ` +
        'A sponsoredBadge selector has gone broad — run `npx tsx scripts/check-sponsored.ts` ' +
        'to see which signal is over-matching before trusting this result.',
    );
  }

  return products;
}
