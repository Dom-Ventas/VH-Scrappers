import { Locator, Page } from 'playwright';
import { config } from './config';
import { Product } from './types';
import { detectSponsored, extractProduct, ownTrackingIdPrefix, SELECTORS } from './extractors';
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

/**
 * How long to wait before re-checking sponsored badges when the first pass
 * found none. Flipkart's ad markup is attached client-side and can trail the
 * product grid by a second or so on slow hardware.
 */
const SPONSORED_RETRY_DELAY_MS = 1_500;

/**
 * Re-run sponsored detection on every card when the first pass found no ads.
 *
 * Zero ads on a full Flipkart results page is rare — the page usually seeds
 * about a third of the first 20 tiles with paid placements — so an all-organic
 * result is far more likely to be a race with Flipkart's ad script than a
 * genuine reading. Sending it as-is makes the backend fill both the competitor
 * and the organic slots from the same products. Waiting once and re-checking
 * costs 1.5 s per affected query and recovers the split in the common case.
 *
 * Mutates `products[i].isSponsored` in place and returns how many cards are
 * sponsored after the retry. When the retry still finds none, logs each
 * card's tracking-id prefix so the run log shows whether Flipkart served no
 * ads (uuid prefixes) or the selectors have drifted (`en_` prefixes).
 */
export async function retrySponsoredDetection(
  cards: Locator,
  products: Product[],
  searchTerm: string,
): Promise<number> {
  if (products.length === 0 || products.some((p) => p.isSponsored)) {
    return products.filter((p) => p.isSponsored).length;
  }

  console.warn(
    `[SPONSORED] "${searchTerm}": 0/${products.length} cards detected as sponsored on first pass; ` +
      `waiting ${SPONSORED_RETRY_DELAY_MS}ms and re-checking`,
  );
  await sleep(SPONSORED_RETRY_DELAY_MS);

  let found = 0;
  for (let i = 0; i < products.length; i++) {
    // Cards that failed extraction have no PID; the backend drops them anyway.
    if (!products[i].asin) continue;
    if (await detectSponsored(cards.nth(i))) {
      products[i].isSponsored = true;
      found++;
    }
  }

  if (found > 0) {
    console.warn(`[SPONSORED] "${searchTerm}": retry detected ${found}/${products.length} sponsored`);
    return found;
  }

  const prefixes: string[] = [];
  for (let i = 0; i < products.length; i++) {
    prefixes.push(`${i + 1}:${(await ownTrackingIdPrefix(cards.nth(i))) || '?'}`);
  }
  console.warn(
    `[SPONSORED] "${searchTerm}": still 0 sponsored after retry — comp and org slots will be ` +
      `identical for this row. Card tkid prefixes: ${prefixes.join(' ')}`,
  );
  return 0;
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

  await retrySponsoredDetection(cards, products, searchTerm);

  return products;
}
