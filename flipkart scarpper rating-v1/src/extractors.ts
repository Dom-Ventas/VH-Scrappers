import { Page } from 'playwright';

import { normalizeText, decodeHtmlEntities } from './util';

import {
  ProductReviewResult,
  Review
} from './types';

import { parseDeliveryPromiseDays } from './delivery';

import {
  parseReviewsFromText,
  parseRelativeDateDays
} from './reviewParser';

import {
  PageData,
  fetchPageData,
  findWidget,
  findWidgets,
  widgetTypes,
  looksLikeProductPage,
  looksLikeReviewPage
} from './pageApi';

/**
 * Flipkart's markup has no stable selectors (see reviewParser.ts), so the few
 * places that still touch the DOM anchor on rendered text instead. These are
 * the strings that matter.
 */
export const TEXT_ANCHORS = {
  /** "Delivery\nby 21 Aug, Fri" — shown even when no pincode is set. */
  deliveryPromise: /Deliver(?:y|ed)?\s*by\s*([^\n]{3,60})/i,

  /** Present while no delivery location has been chosen. */
  locationNotSet: /Location not set|Select delivery location/i,

  /** CMS bucket that serves Rich Product Description imagery. */
  rpdImage: 'cms-rpd-img'
};

/** Nudge lazy-loaded sections into the DOM before reading it. */
export async function hydrateLazySections(
  page: Page
): Promise<void> {

  try {

    await page.evaluate(async () => {
      const step = 1200;

      for (let y = 0; y < step * 12; y += step) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 250));
      }

      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(800);

  } catch {}
}

/**
 * Product identity, rating and rating count come from the JSON-LD block rather
 * than the DOM. It is a public schema.org contract, it is present on every
 * product page, and it sidesteps parsing Indian digit grouping out of display
 * text ("2,47,238").
 */
async function readJsonLd(
  page: Page
): Promise<any | null> {

  try {

    return await page.evaluate(() => {

      const blocks = Array.from(
        document.querySelectorAll(
          'script[type="application/ld+json"]'
        )
      );

      for (const block of blocks) {

        try {

          const parsed = JSON.parse(
            block.textContent || ''
          );

          const candidates = Array.isArray(parsed)
            ? parsed
            : [parsed];

          for (const entry of candidates) {
            if (entry && (entry.sku || entry.aggregateRating)) {
              return entry;
            }
          }

        } catch {}
      }

      return null;
    });

  } catch {

    return null;
  }
}

/** Breadcrumb path — the closest thing Flipkart has to a Best Sellers Rank. */
function readBreadcrumbs(
  pageData: PageData | null,
  jsonLd: any | null
): string {

  const widget = findWidget(pageData, 'PRODUCT_BREADCRUMBS');

  const crumbs = widget?.breadcrumbs;

  if (Array.isArray(crumbs)) {

    const path = crumbs
      .map((c: any) => c?.title || c?.value?.title || c?.text)
      .filter(Boolean)
      .join(' / ');

    if (path) {
      return path;
    }
  }

  return normalizeText(jsonLd?.category || '');
}

export async function extractProductDetails(
  page: Page,
  pid: string,
  pageData: PageData | null
): Promise<ProductReviewResult> {

  const jsonLd = await readJsonLd(page);

  if (!jsonLd) {
    throw new Error(
      `No product data (JSON-LD) found for PID ${pid}`
    );
  }

  const aggregate = jsonLd.aggregateRating || {};

  const rating = Number(aggregate.ratingValue) || 0;

  // ratingCount is the number of star ratings, reviewCount the subset that also
  // wrote text. Amazon's totalRatings is the former.
  const totalRatings =
    Number(aggregate.ratingCount) ||
    Number(aggregate.reviewCount) ||
    0;

  return {
    pid,

    title: normalizeText(jsonLd.name),

    rating,

    totalRatings,

    bestSellersRank: readBreadcrumbs(pageData, jsonLd),

    criticalReviews: []
  };
}

/**
 * Reads the delivery promise off the product page and converts it into a day
 * count relative to today (promise date - today).
 *
 * Flipkart renders "Delivery by 21 Aug, Fri" even with no pincode selected, so
 * a promise is normally readable. Returns { days: null } when the page shows
 * none at all (out of stock, no seller offer).
 */
export async function extractDeliveryPromise(
  page: Page
): Promise<{ days: number | null; text: string }> {

  let deliveryText = '';

  try {

    const bodyText =
      (await page.innerText('body')) || '';

    const match = bodyText.match(
      TEXT_ANCHORS.deliveryPromise
    );

    if (match) {
      deliveryText = normalizeText(match[1]);
    }

  } catch {}

  if (!deliveryText) {
    console.log('[DELIVERY] No delivery promise found on page');
    return { days: null, text: '' };
  }

  const days = parseDeliveryPromiseDays(deliveryText);

  console.log(
    `[DELIVERY] "${deliveryText}" -> ${days === null ? 'unparsed' : `${days} day(s)`}`
  );

  return { days, text: deliveryText };
}

/**
 * Whether Flipkart is using the pincode set during first run. When it still
 * says "Location not set" the delivery promise is geo-guessed and will drift
 * between runs, so this is surfaced rather than silently accepted.
 *
 * Returns null when the answer is unknowable — a page that failed to render has
 * no "Location not set" text either, and inferring "pincode applied" from that
 * absence reports the *opposite* of the truth. Requiring positive evidence (a
 * delivery section) keeps a broken page from masquerading as a configured one.
 */
export async function extractPincodeApplied(
  page: Page
): Promise<boolean | null> {

  try {

    const bodyText =
      (await page.innerText('body')) || '';

    if (!/Deliver/i.test(bodyText)) {
      return null;
    }

    return !TEXT_ANCHORS.locationNotSet.test(bodyText);

  } catch {

    return null;
  }
}

/**
 * Flipkart's A+ content equivalent is the RPD (Rich Product Description)
 * widget: brand-authored copy and imagery in templated modules, served from the
 * `cms-rpd-img` CMS bucket.
 *
 * Detection goes through the page-data API rather than the DOM because these
 * sections lazy-render unreliably — on one sampled product only 1 of 18 RPD
 * images ever rendered — so a DOM check produces false negatives. The DOM path
 * remains as a fallback, and the answer records which path produced it so a
 * silent degradation to the weaker check is visible in the output.
 */
export async function extractAplusContent(
  page: Page,
  pid: string,
  pageData: PageData | null
): Promise<{
  aplus: "yes" | "no";
  featureCount: number;
  source: "api" | "dom" | "none";
}> {

  // 1. The page-data API, when it carries RPD.
  const rpd = pageData ? findWidget(pageData, 'RPD') : null;

  const apiCount = (rpd?.featureSetList ?? [])
    .flatMap((set: any) => set?.features ?? [])
    .length;

  if (apiCount > 0) {
    return { aplus: 'yes', featureCount: apiCount, source: 'api' };
  }

  // 2. The rendered page. This is NOT just a fallback for a broken API call —
  //    the API legitimately omits the RPD widget for products that plainly do
  //    have rich content. boAt Airdopes (ACCG6DS7WDJHGWSH) returns 21 healthy
  //    widgets and no RPD, while its page renders a real cms-rpd-img asset.
  //    So a "no" from the API is not evidence of absence, and both signals have
  //    to miss before A+ can be called absent.
  try {

    await hydrateLazySections(page);

    const domCount = await countRpdAssets(page);

    if (domCount > 0) {
      return { aplus: 'yes', featureCount: domCount, source: 'dom' };
    }

    // Neither source found anything. Only call that a real "no" if the API
    // response was a genuine product page; otherwise both signals may simply
    // have failed to load.
    if (pageData && looksLikeProductPage(pageData)) {
      return { aplus: 'no', featureCount: 0, source: 'api' };
    }

    console.warn(
      `[A+ CHECK] ${pid} -> no RPD in either source, and the page API returned ` +
        `${widgetTypes(pageData).length} widget(s) with no product layout. ` +
        `Reporting "no" with low confidence.`
    );

    return { aplus: 'no', featureCount: 0, source: 'none' };

  } catch (err) {

    console.error('[A+ CHECK ERROR]', err);

    return { aplus: 'no', featureCount: 0, source: 'none' };
  }
}

/**
 * Distinct Rich Product Description images on the rendered page.
 *
 * Counting raw occurrences of the path would badly overcount: each asset is
 * emitted once per responsive `srcset` breakpoint, so a single image shows up
 * seven times. The asset hash in the URL is what identifies the image, so
 * dedupe on that.
 *
 * The number is a floor, not a module count — Flipkart hydrates only the first
 * RPD image until the user scrolls into the section, so a product the API
 * reports as 18 modules renders as 1 here. That is fine: the caller only needs
 * "is there any", and the count exists purely for the debug log.
 */
async function countRpdAssets(
  page: Page
): Promise<number> {

  const html = await page.content();

  const matches = html.matchAll(
    /cms-rpd-img\/([a-f0-9]{16,})/gi
  );

  const assets = new Set<string>();

  for (const match of matches) {
    assets.add(match[1].toLowerCase());
  }

  return assets.size;
}

/**
 * Long review bodies render clipped with a "more" control. Flipkart's
 * React-Native-Web layer ignores synthetic click events, so this is best-effort
 * via Playwright's trusted clicks; anything still clipped is flagged
 * `truncated` on the review rather than silently stored short.
 */
async function expandTruncatedReviews(
  page: Page
): Promise<void> {

  try {

    const more = page.getByText(/^\s*more\s*$/i);

    const count = Math.min(await more.count(), 20);

    for (let i = 0; i < count; i++) {
      await more
        .nth(i)
        .click({ timeout: 1500 })
        .catch(() => {});
    }

  } catch {}
}

/**
 * Reviews from the page-data API — one REVIEWS widget per review, each holding
 * a typed ProductReviewValue.
 *
 * This mirrors the Amazon scraper's shape: get a list of review units, then
 * read each field by name off the unit. The difference is that Amazon reads
 * fields via per-field DOM selectors and this reads them off a JSON object,
 * because Flipkart's markup exposes no selectors to bind to.
 *
 * It also returns review bodies IN FULL. The rendered page clips long reviews
 * with a "...more" control that ignores synthetic clicks, so the DOM path can
 * only ever capture a truncated message.
 */
export function extractReviewsFromApi(
  pageData: PageData | null
): Review[] {

  const widgets = findWidgets(pageData, 'REVIEWS');

  const reviews: Review[] = [];

  for (const widget of widgets) {

    for (const component of widget?.renderableComponents ?? []) {

      const value = component?.value;

      if (!value || value.type !== 'ProductReviewValue') {
        continue;
      }

      const rating = Number(value.rating);

      if (!Number.isFinite(rating) || rating === 0) {
        continue;
      }

      const date = normalizeText(value.created);

      reviews.push({
        rating,

        title: decodeHtmlEntities(normalizeText(value.title)),

        text: decodeHtmlEntities(normalizeText(value.text)),

        author: normalizeText(value.author),

        location: normalizeText(value.location?.city),

        date,

        dateDays: parseRelativeDateDays(date),

        verifiedPurchase: Boolean(value.certifiedBuyer),

        helpfulCount: Number(value.helpfulCount) || 0,

        reviewId: value.id ? String(value.id) : undefined,

        // Never clipped on this path — that is the point of using it.
        truncated: false
      });
    }
  }

  return reviews;
}

/**
 * Reviews parsed out of the review page currently loaded in the browser.
 *
 * Only ever reflects the page the browser is actually on, so the caller must
 * navigate to the right review page before calling it. Bodies clipped with
 * "...more" cannot be expanded (the control ignores synthetic clicks), so they
 * are flagged `truncated` rather than passed off as complete.
 */
export async function extractReviewsFromDom(
  page: Page
): Promise<Review[]> {

  await expandTruncatedReviews(page);

  const pageText =
    (await page.innerText('body')) || '';

  // Flipkart renders some review cards more than once (responsive variants),
  // so the same review can appear several times in innerText. Collapse them
  // here rather than reporting a count the page does not actually contain.
  const seen = new Set<string>();

  const reviews = parseReviewsFromText(pageText).filter(review => {
    const key = `${review.rating}|${review.title}|${review.text}|${review.author}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  console.log(
    `[REVIEWS] ${reviews.length} review(s) via DOM`
  );

  return reviews;
}

export { fetchPageData };
