import { Page } from 'playwright';

import { config } from './config';

import {
  extractProductDetails,
  extractCriticalReviews,
  extractDeliveryPromise
} from './extractors';

import {
  ProductReviewResult,
  Review
} from './types';

function buildProductUrl(
  domain: string,
  asin: string
): string {

  const cleanDomain =
    domain
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

  return `https://${cleanDomain}/dp/${asin}`;
}

export async function checkAplusContent(
  page: Page,
  domain?: string,
  asin?: string
): Promise<"yes" | "no"> {

  // 1. Cookie Modal Dismissal (non-blocking)
  try {
    const cookieBtn = page.locator('#sp-cc-accept, input#sp-cc-accept, button[id*="accept"]');
    if (await cookieBtn.first().isVisible().catch(() => false)) {
      await cookieBtn.first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  } catch {}

  // 2. Direct CDP Protocol HTML Check (Works 100% identically in VS Code & compiled .exe binary)
  try {
    const fullHtml = await page.content();
    if (
      fullHtml.includes('aplus-media-library-service-media') ||
      fullHtml.includes('class="aplus-v2') ||
      fullHtml.includes('class="aplus-module') ||
      fullHtml.includes('class="premium-aplus') ||
      fullHtml.includes('aplus-brand-story') ||
      fullHtml.includes('data-aplus-module')
    ) {
      console.log('[A+ CHECK] Detected active A+ content via page.content()');
      return "yes";
    }
  } catch {}

  // 3. Multi-step scroll + lazy-loading triggers to force IntersectionObserver hydration across all marketplaces
  try {
    await page.evaluate(async () => {
      const positions = [1500, 3500, 5500];
      for (const pos of positions) {
        window.scrollTo(0, pos);
        await new Promise((r) => setTimeout(r, 250));
      }

      // Force lazy loading hydration for offscreen images & A+ containers
      const lazyEls = document.querySelectorAll('img[data-src], img[loading="lazy"], .aplus-v2, #aplus_feature_div, [data-cel-widget*="aplus"]');
      lazyEls.forEach((el) => {
        void el.getBoundingClientRect();
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      window.dispatchEvent(new Event('scroll'));
    }).catch(() => {});
    await page.waitForTimeout(1000);
  } catch {}

  // 4. In-Browser DOM Evaluation (checks active A+ modules, images, and content)
  try {
    const hasAplus = await page.evaluate(() => {
      const selectors = [
        '#aplus', '#aplus3p_feature_div', '#aplus_feature_div',
        '#dpx-aplus-product-description_feature_div', '#aplus_v2_feature_div',
        '#premium-aplus-content', '#premiumAplus_feature_div', '#premium-aplus',
        '#aplusBrandStory_feature_div', '#brandStory_feature_div', '#brandStory',
        '#aplusSustainabilityStory_feature_div', '#psxElevatedAplusContainer',
        '#fromTheManufacturer_feature_div', '#fromTheManufacturer',
        '#manufacturerDescription_feature_div', '#manufacturerContent',
        '.aplus-v2', '.aplus-module',
        '.premium-aplus', '.premium-aplus-module', '.aplus-brand-story-card',
        '.aplus-brand-story-wrapper', '[data-cel-widget*="aplus"]',
        '[data-cel-widget*="manufacturer"]', '[data-cel-widget*="brandStory"]',
        '[data-feature-name="aplus"]', '[data-feature-name="aplusBrandStory"]',
        '[data-feature-name="brandStory"]', '[data-feature-name="fromTheManufacturer"]',
        '[data-feature-name*="aplus"]', '[data-feature-name*="manufacturer"]',
        'iframe[id*="aplus"]', 'iframe[src*="aplus"]'
      ];

      for (const sel of selectors) {
        const nodes = document.querySelectorAll(sel);
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const text = (node.textContent || '').trim();
          const hasImages = node.querySelectorAll('img').length > 0;
          const hasModules = node.querySelectorAll('.aplus-module, .aplus-v2, .premium-aplus, img, p, table, iframe').length > 0;
          if (hasImages || hasModules || text.length > 50) {
            return true;
          }
        }
      }

      return false;
    }).catch(() => false);

    if (hasAplus) {
      console.log('[A+ CHECK] Detected active A+ content modules');
      return "yes";
    }
  } catch (err) {
    console.error('[A+ CHECK ERROR]', err);
  }

  return "no";
}

export async function scrapeAsin(
  page: Page,
  domain: string,
  asin: string
): Promise<ProductReviewResult> {

  const productUrl =
    buildProductUrl(
      domain,
      asin
    );

  console.log(
    `[SCRAPE] GET ${productUrl}`
  );

  await page.goto(
    productUrl,
    {
      waitUntil: 'domcontentloaded'
    }
  );

  const pageTitle =
    await page.title();

  console.log(
    '[PRODUCT TITLE]',
    pageTitle
  );

  if (
    pageTitle.includes(
      'Looking for something'
    ) ||
    pageTitle.includes(
      'Page Not Found'
    )
  ) {

    throw new Error(
      `Invalid ASIN: ${asin}`
    );
  }

  try {

    await page.waitForSelector(
      '#productTitle',
      {
        timeout:
          config.resultsWaitTimeoutMs
      }
    );

  } catch {

    throw new Error(
      `No product page loaded for "${asin}"`
    );
  }

  const product =
    await extractProductDetails(
      page,
      asin
    );

  // Wait for full page load so lazy-loaded A+ content sections render into DOM
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch {
    // networkidle may timeout on heavy pages — that's fine, continue
  }

  // Delivery promise is read before the A+ check, which scrolls the page.
  try {
    const delivery = await extractDeliveryPromise(page);

    // Whole number of days when a promise is shown, null when the page has
    // none (out of stock, no offer) — so 0 stays reserved for same-day.
    product.deliveryPromiseDays = delivery.days;
    product.deliveryText = delivery.text;
  } catch (err) {
    console.warn('[DELIVERY] Failed to read delivery promise', err);
    product.deliveryPromiseDays = null;
    product.deliveryText = '';
  }

  console.log(
    `[DELIVERY PROMISE] ${asin} -> ${product.deliveryPromiseDays} day(s)`
  );

  const aplusStatus = await checkAplusContent(page, domain, asin);
  console.log(`[A+ CONTENT] ${asin} -> ${aplusStatus}`);
  product.aplus_content = aplusStatus;
  product.aplusContent = aplusStatus;

  const criticalReviews: Review[] =
    [];

  let reviewUrl = '';

  try {

    const reviewLink =
      page.locator(
        'a[data-hook="see-all-reviews-link-foot"]'
      );

    const href =
      await reviewLink
        .first()
        .getAttribute('href');

    if (href) {

      const baseUrl =
        href.startsWith('http')
          ? href
          : `https://${domain}${href}`;

      reviewUrl =
        baseUrl.includes('?')
          ? `${baseUrl}&sortBy=recent&filterByStar=critical`
          : `${baseUrl}?sortBy=recent&filterByStar=critical`;
    }

  } catch {}

  if (!reviewUrl) {

    reviewUrl =
      `https://${domain}/product-reviews/${asin}/?reviewerType=all_reviews&sortBy=recent&filterByStar=critical`;
  }

  console.log(
    '[AMAZON REVIEW URL]',
    reviewUrl
  );

  await page.goto(
    reviewUrl,
    {
      waitUntil:
        'domcontentloaded'
    }
  );

  console.log(
    '[REVIEW URL]',
    page.url()
  );

  console.log(
    '[REVIEW TITLE]',
    await page.title()
  );

  // ========================================
// Amazon Sign-In Handling (Persistent Profile)
// ========================================

if (page.url().includes('/ap/signin')) {

  console.log(
    '[AUTH] Amazon redirected to Sign-In.'
  );

  console.log(
    '[AUTH] Please sign in using this browser window.'
  );

  console.log(
    '[AUTH] The session will be saved in the persistent Playwright profile.'
  );

  await page.waitForURL(
    url => !url.toString().includes('/ap/signin'),
    {
      timeout: 0
    }
  );

  console.log(
    '[AUTH] Login detected.'
  );

  await page.waitForLoadState(
    'networkidle'
  );

  console.log(
    '[AUTH] Continuing review scraping...'
  );
}

  const reviewPageTitle =
    await page.title();
if (page.url().includes('/ap/signin')) {

  throw new Error(
    'Amazon session expired. Please log in again.'
  );
}
  if (
    reviewPageTitle.includes(
      'Looking for something'
    ) ||
    reviewPageTitle.includes(
      'Page Not Found'
    ) ||
    reviewPageTitle.includes(
      'Sorry'
    )
  ) {

    throw new Error(
      `Invalid review page for ASIN ${asin}`
    );
  }

  let reviewPage = 1;

  while (true) {

    try {

      await page.waitForSelector(
        '[data-hook="review"]',
        {
          timeout:
            config.resultsWaitTimeoutMs
        }
      );

    } catch {

      console.log(
        `[REVIEWS] No review cards found on page ${reviewPage}`
      );

      break;
    }

    const pageReviews =
      await extractCriticalReviews(
        page
      );

    console.log(
      `[REVIEWS] Page ${reviewPage}: ${pageReviews.length} critical reviews`
    );

    criticalReviews.push(
      ...pageReviews
    );

    console.log(
      `[REVIEWS] Total collected: ${criticalReviews.length}`
    );

    if (
      criticalReviews.length >=
      config.maxCriticalReviews
    ) {

      console.log(
        `[REVIEWS] Reached limit of ${config.maxCriticalReviews}`
      );

      break;
    }

    const nextButton =
      page.locator(
        '.a-pagination .a-last a, li.a-last a'
      );

    if (
      await nextButton.count() === 0
    ) {

      console.log(
        '[REVIEWS] Last review page reached'
      );

      break;
    }

    await nextButton
      .first()
      .click();

    await page.waitForLoadState(
      'networkidle'
    );

    await page.waitForTimeout(
      2000
    );

    reviewPage++;

    if (
      reviewPage >
      config.maxReviewPages
    ) {

      console.log(
        `[REVIEWS] Safety page limit reached (${config.maxReviewPages})`
      );

      break;
    }
  }

  product.criticalReviews =
    criticalReviews.slice(
      0,
      config.maxCriticalReviews
    );

  console.log(
    `[FILTER] ${product.criticalReviews.length} critical reviews kept`
  );

  return product;
}