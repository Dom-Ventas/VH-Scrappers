import { Page } from 'playwright';
import { Review } from './types';
import { normalizeText } from './util';

/**
 * eBay splits what this scraper needs over two pages:
 *
 *   - the LISTING page `/itm/<itemId>` — title, price, the "Delivery:" estimate
 *     for the session's ship-to location, and (only when the listing is
 *     matched to an eBay catalogue product) a link to that product's reviews,
 *     `/urw/<slug>/product-reviews/<epid>?_itm=<itemId>`;
 *   - the product REVIEWS page `/urw/product-reviews/<epid>?_itm=…&sort=+rating&pgn=N`
 *     — schema.org microdata for the aggregate (`ratingValue`, `reviewCount`),
 *     the per-star histogram and 10 reviews per page, each an
 *     `itemprop="review"` block with its own `ratingValue`.
 *
 * Both pages render the same on every eBay site; only the words change
 * ("Verified purchase: Yes" / "Bestätigter Kauf: Ja").
 *
 * Verified on www.ebay.com and www.ebay.de, 2026-10-14 (Skullcandy Sesh ANC
 * 265983500898 → epid 17054784938; Sony WH-1000XM5 278359701353 → 22054478105).
 *
 * The readers are kept as source strings so the bundler cannot inject helpers
 * (tsx's `__name`) that do not exist in the page.
 */
export const SELECTORS = {
  title: 'h1.x-item-title__mainTitle',
  /** "Delivery: Estimated between Fri, Oct 16 and Tue, Oct 20 to 10001". */
  delivery: '.ux-labels-values--deliverto .ux-labels-values__values',
  /**
   * "Shipping: Free 2-4 day delivery Get it between Fri, Oct 16 and Mon, Oct 19
   * to 10001." — where eBay puts the estimate on listings that have no
   * separate "Delivery:" row (Apple AirPods 4, 135533595343).
   */
  shipping: '.ux-labels-values--shipping .ux-labels-values__values',
  price: '.x-price-primary',
  /** One block per review on the reviews page. */
  review: '[itemprop="review"]',
} as const;

export interface ListingPageData {
  title: string | null;
  /** The catalogue product id from the listing's own "See all reviews" link. */
  epid: string | null;
  deliveryText: string | null;
  priceText: string | null;
  /** eBay's "We looked everywhere. Looks like this page is missing." */
  notFound: boolean;
}

const LISTING_READER = (itemId: string) => `(() => {
  const text = (sel) => { const el = document.querySelector(sel); return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
  let epid = null;
  for (const a of document.querySelectorAll('a[href*="/product-reviews/"]')) {
    const m = a.href.match(/\\/urw\\/(?:[^/]+\\/)?product-reviews\\/(\\d+)/);
    if (!m) continue;
    const itm = new URL(a.href).searchParams.get('_itm');
    if (itm && itm !== ${JSON.stringify(itemId)}) continue;
    epid = m[1];
    break;
  }
  const body = document.body ? document.body.innerText : '';
  return {
    title: text(${JSON.stringify(SELECTORS.title)}),
    epid,
    deliveryText: text(${JSON.stringify(SELECTORS.delivery)}) || text(${JSON.stringify(SELECTORS.shipping)}),
    priceText: text(${JSON.stringify(SELECTORS.price)}),
    notFound: !document.querySelector(${JSON.stringify(SELECTORS.title)}) &&
      /looks like this page is missing|we looked everywhere|seite fehlt|haben überall gesucht/i.test(body),
  };
})()`;

export async function readListingPage(page: Page, itemId: string): Promise<ListingPageData> {
  return (await page.evaluate(LISTING_READER(itemId))) as ListingPageData;
}

/** Wait for the listing's title (or the missing-page copy). false on timeout. */
export async function waitForListing(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      `!!document.querySelector(${JSON.stringify(SELECTORS.title)}) || /looks like this page is missing|we looked everywhere/i.test(document.body ? document.body.innerText : '')`,
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

export interface RawReview {
  id: string | null;
  rating: number | null;
  title: string | null;
  text: string | null;
  author: string | null;
  date: string | null;
  verified: boolean;
  /**
   * eBay pins one "TOP CRITICAL" and one "TOP FAVORABLE" review above the
   * list whatever the sort (`data-type="critical"` / `"favorable"`). They are
   * kept like any other review but never decide where the sort has got to.
   */
  pinned: boolean;
}

export interface ReviewsPageData {
  /** Aggregate `ratingValue` — the product's average across all sellers. */
  rating: number | null;
  /** Aggregate `reviewCount` — "72 product ratings". */
  ratingCount: number | null;
  /** Per-star counts from the histogram, keyed 1–5. Empty when absent. */
  histogram: Record<string, number>;
  reviews: RawReview[];
  /** A link to page `pgn + 1` exists. */
  hasNext: boolean;
}

const REVIEWS_READER = (pageNo: number) => `(() => {
  const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const agg = document.querySelector('[itemprop="aggregateRating"]');
  const meta = (root, prop) => { const el = root && root.querySelector('meta[itemprop="' + prop + '"]'); return el ? el.getAttribute('content') : null; };
  const histogram = {};
  for (const li of document.querySelectorAll('.ebay-review-item')) {
    const stars = li.querySelector('.ebay-review-item-stars');
    const count = li.querySelector('.ebay-review-item-c');
    const s = stars ? parseInt((stars.textContent || '').trim(), 10) : NaN;
    const c = count ? parseInt((count.textContent || '').replace(/[^\\d]/g, ''), 10) : NaN;
    if (s >= 1 && s <= 5 && Number.isFinite(c)) histogram[String(s)] = c;
  }
  const reviews = [];
  for (const el of document.querySelectorAll('[itemprop="review"]')) {
    const get = (sel) => { const n = el.querySelector(sel); return n ? (n.textContent || '').replace(/\\s+/g, ' ').trim() : null; };
    const rating = el.querySelector('[itemprop="reviewRating"] meta[itemprop="ratingValue"]');
    const date = el.querySelector('[itemprop="datePublished"]');
    const attrs = get('.review-attr') || '';
    const type = (el.getAttribute('data-type') || '').toLowerCase();
    reviews.push({
      id: (el.id || '').replace(/^review_/, '') || null,
      rating: rating ? num(rating.getAttribute('content')) : null,
      title: get('[itemprop="name"]'),
      text: get('[itemprop="reviewBody"]'),
      author: get('[itemprop="author"]'),
      date: date ? (date.getAttribute('content') || (date.textContent || '').trim()) : null,
      verified: /(?:verified purchase|best\u00e4tigter kauf|verifizierter kauf)\\s*:?\\s*(?:yes|ja)/i.test(attrs),
      pinned: type === 'critical' || type === 'favorable' || type === 'favourable',
    });
  }
  const next = ${pageNo + 1};
  const hasNext = [...document.querySelectorAll('a[href*="pgn="]')].some((a) => new URL(a.href).searchParams.get('pgn') === String(next));
  return {
    rating: num(meta(agg, 'ratingValue')),
    ratingCount: num(meta(agg, 'reviewCount')),
    histogram,
    reviews,
    hasNext,
  };
})()`;

export async function readReviewsPage(page: Page, pageNo: number): Promise<ReviewsPageData> {
  return (await page.evaluate(REVIEWS_READER(pageNo))) as ReviewsPageData;
}

/** Wait for the aggregate block or a review. false on timeout. */
export async function waitForReviews(page: Page, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForSelector('[itemprop="aggregateRating"], [itemprop="review"]', {
      timeout: timeoutMs,
      state: 'attached',
    });
    return true;
  } catch {
    return false;
  }
}

/** Map one page of raw reviews onto the backend's review shape. */
export function toReviews(raw: readonly RawReview[]): Review[] {
  return raw
    .filter((r) => typeof r.rating === 'number' && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)
    .map((r) => ({
      reviewId: normalizeText(r.id) || undefined,
      rating: r.rating as number,
      title: normalizeText(r.title) || undefined,
      text: normalizeText(r.text) || undefined,
      author: normalizeText(r.author) || undefined,
      date: normalizeText(r.date) || undefined,
      verifiedPurchase: r.verified,
    }));
}

/** How many 1–2 star ratings the histogram reports, or null without one. */
export function criticalExpected(histogram: Record<string, number>): number | null {
  const one = histogram['1'];
  const two = histogram['2'];
  if (typeof one !== 'number' || typeof two !== 'number') return null;
  return one + two;
}
