import { Page } from 'playwright';

import { config } from './config';

import {
  extractProductDetails,
  extractCriticalReviews
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