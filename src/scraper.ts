import { Page } from 'playwright';
import { config } from './config';
import { Product } from './types';
import { extractProduct, SELECTORS } from './extractors';

function buildSearchUrl(domain: string, searchTerm: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const q = encodeURIComponent(searchTerm.trim());
  return `https://${cleanDomain}/s?k=${q}`;
}

export async function scrapeSearchTerm(
  page: Page,
  domain: string,
  searchTerm: string,
): Promise<Product[]> {
  const url = buildSearchUrl(domain, searchTerm);
  console.log(`[SCRAPE] GET ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForSelector(SELECTORS.resultCard, {
      timeout: config.resultsWaitTimeoutMs,
    });
  } catch {
    throw new Error(
      `No search results loaded for "${searchTerm}" (possible CAPTCHA or block page).`,
    );
  }

  const cards = page.locator(SELECTORS.resultCard);
  const total = await cards.count();
  const take = Math.min(total, config.topNResults);

  const products: Product[] = [];
  for (let i = 0; i < take; i++) {
    try {
      const product = await extractProduct(cards.nth(i), i + 1);
      products.push(product);
    } catch (err) {
      console.warn(`[SCRAPE] Failed to extract product at position ${i + 1}:`, err);
      products.push({
        position: i + 1,
        asin: null,
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

  return products;
}
