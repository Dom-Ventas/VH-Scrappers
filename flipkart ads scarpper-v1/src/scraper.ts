import { Page } from 'playwright';
import { config } from './config';
import { Product } from './types';
import { extractProduct, SELECTORS } from './extractors';
import { sleep } from './util';

function buildSearchUrl(domain: string, searchTerm: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const q = encodeURIComponent(searchTerm.trim());
  // marketplace=FLIPKART pins results to the main storefront (excludes Grocery
  // etc.), which keeps the card layout consistent across queries.
  return `https://${cleanDomain}/search?q=${q}&marketplace=FLIPKART`;
}

/**
 * Flipkart throws a full-screen login modal at logged-out visitors on the first
 * navigation of a session. It swallows clicks and hides the lower half of the
 * grid, so dismiss it before extracting. No-op once the user is signed in.
 */
async function dismissLoginModal(page: Page): Promise<void> {
  const closeButtons = ['button._2KpZ6l._2doB4z', 'button:has-text("✕")', 'span._30XB9F'];
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
  domain: string,
  searchTerm: string,
): Promise<Product[]> {
  const url = buildSearchUrl(domain, searchTerm);
  console.log(`[SCRAPE] GET ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await dismissLoginModal(page);

  try {
    await page.waitForSelector(SELECTORS.resultCard, {
      timeout: config.resultsWaitTimeoutMs,
    });
  } catch {
    throw new Error(
      `No search results loaded for "${searchTerm}" (possible CAPTCHA or block page).`,
    );
  }

  // Flipkart lazy-renders the delivery/rating strip on tiles below the fold.
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
