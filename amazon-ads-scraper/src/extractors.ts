import { Locator, Page } from 'playwright';
import { Product } from './types';
import { parseIntSafe, parseFloatSafe, parseDeliveryDays } from './util';

// Selectors are kept here so they're easy to update when Amazon changes its DOM.
export const SELECTORS = {
  resultCard: 'div[data-component-type="s-search-result"]',
  sponsoredBadge: [
    'span.puis-label-popover-default:has-text("Sponsored")',
    'a[aria-label*="Sponsored" i]',
    'span:has-text("Sponsored")',
  ],
  title: ['h2 a span', 'h2 span'],
  titleImageAlt: 'img.s-image',
  price: ['.a-price .a-offscreen', '.a-price-whole'],
  ratingIcon: 'i[class*="a-star"] .a-icon-alt',
  // The review anchor carries the exact count in its aria-label
  // e.g. aria-label="30,795 ratings". The visible span is compressed ("30.7K"),
  // so we prefer the aria-label.
  reviewCountAnchor: 'a[aria-label$="ratings"], a[aria-label$="rating"]',
  delivery: ['[data-cy="delivery-recipe"]', '.udm-primary-delivery-message'],
} as const;

async function firstText(card: Locator, selectors: readonly string[]): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const loc = card.locator(sel).first();
      if ((await loc.count()) > 0) {
        const text = (await loc.innerText({ timeout: 2_000 })).trim();
        if (text) return text;
      }
    } catch {
      // fall through to next selector
    }
  }
  return null;
}

async function hasAnySponsored(card: Locator, selectors: readonly string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      if ((await card.locator(sel).count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export async function extractProduct(card: Locator, position: number): Promise<Product> {
  let asin: string | null = null;
  try {
    asin = (await card.getAttribute('data-asin')) || null;
    if (asin && !asin.trim()) asin = null;
  } catch {
    asin = null;
  }

  const isSponsored = await hasAnySponsored(card, SELECTORS.sponsoredBadge);

  // Title: prefer the <h2> text; for sponsored cards the h2 often contains only
  // the brand name, so fall back to the product image alt (stripping the
  // "Sponsored Ad - " prefix Amazon adds).
  let title = await firstText(card, SELECTORS.title);
  if (!title || title.length < 20 || title.split(/\s+/).length < 3) {
    try {
      const imgLoc = card.locator(SELECTORS.titleImageAlt).first();
      if ((await imgLoc.count()) > 0) {
        const alt = await imgLoc.getAttribute('alt');
        if (alt && alt.trim()) {
          title = alt.replace(/^Sponsored Ad\s*-\s*/i, '').trim();
        }
      }
    } catch {
      // keep existing title (may be null)
    }
  }

  let price: string | null = null;
  try {
    // `.a-price .a-offscreen` is visually hidden (via CSS clip), so innerText()
    // returns empty — use textContent() to get the real value.
    const priceLoc = card.locator(SELECTORS.price[0]).first();
    if ((await priceLoc.count()) > 0) {
      price = (await priceLoc.textContent())?.trim() || null;
    }
    if (!price) {
      // Fallback: the visible whole-rupee/dollar integer part.
      price = await firstText(card, [SELECTORS.price[1]]);
    }
  } catch {
    price = null;
  }

  let rating: number | null = null;
  try {
    const ratingLoc = card.locator(SELECTORS.ratingIcon).first();
    if ((await ratingLoc.count()) > 0) {
      const ratingText = (await ratingLoc.textContent())?.trim() || null;
      rating = parseFloatSafe(ratingText);
    }
  } catch {
    rating = null;
  }

  let reviewCount: number | null = null;
  try {
    const reviewLoc = card.locator(SELECTORS.reviewCountAnchor).first();
    if ((await reviewLoc.count()) > 0) {
      const label = await reviewLoc.getAttribute('aria-label');
      reviewCount = parseIntSafe(label);
    }
  } catch {
    reviewCount = null;
  }

  const deliveryText = await firstText(card, SELECTORS.delivery);
  const deliveryDays = parseDeliveryDays(deliveryText);

  return {
    position,
    asin,
    isSponsored,
    title,
    price,
    rating,
    reviewCount,
    deliveryText,
    deliveryDays,
  };
}

/**
 * Sponsored Brands banners sit ABOVE the result grid and are NOT
 * `s-search-result` cards, so the card selector never saw them. On amazon.in a
 * brand banner typically carries 3-4 products, and those are the page's FIRST
 * sponsored placements — omitting them made "first 5 sponsored" start several
 * positions too far down.
 *
 * Amazon does not render a review count or a delivery estimate inside these
 * tiles, so those two fields stay null. ASIN, title, price and rating are all
 * available.
 *
 * Runs as a single atomic DOM read and reports each tile's page offset so the
 * caller can merge banner ads into true page order.
 */
const SPONSORED_BRANDS_SCRIPT = `(() => {
  var out = [];
  var widgets = Array.prototype.slice.call(document.querySelectorAll('.s-result-item.s-widget'));
  for (var i = 0; i < widgets.length; i++) {
    var w = widgets[i];
    // A Sponsored Brands creative says "Sponsored" and holds product tiles.
    if (!/sponsored/i.test(w.innerText || '')) continue;
    var tiles = Array.prototype.slice.call(w.querySelectorAll('[data-asin]'));
    var seen = {};
    for (var j = 0; j < tiles.length; j++) {
      var t = tiles[j];
      var asin = t.getAttribute('data-asin');
      if (!asin || seen[asin]) continue;
      seen[asin] = 1;
      var rect = t.getBoundingClientRect();

      // A Sponsored Brands banner is a CAROUSEL: it holds a dozen or more
      // tiles but only shows about three, the rest scrolled out of view behind
      // an overflow-hidden container. Only the visible slots are real
      // placements on page one — taking the hidden ones flooded the sponsored
      // bucket and evicted the Sponsored Products in the grid below.
      var clip = t.parentElement;
      while (clip && clip !== document.body) {
        var st = window.getComputedStyle(clip);
        if (st.overflowX === 'hidden' || st.overflowX === 'auto' || st.overflowX === 'scroll' ||
            st.overflow === 'hidden' || st.overflow === 'auto' || st.overflow === 'scroll') break;
        clip = clip.parentElement;
      }
      if (clip && clip !== document.body) {
        var cr = clip.getBoundingClientRect();
        var shown = Math.min(rect.right, cr.right) - Math.max(rect.left, cr.left);
        // Needs more than half its width inside the visible window to count.
        if (rect.width > 0 && shown < rect.width * 0.5) continue;
      }
      // Zero-size tiles are never rendered.
      if (rect.width < 5 || rect.height < 5) continue;
      var priceEl = t.querySelector('.a-price .a-offscreen') || t.querySelector('.a-price-whole');
      var ratingEl = t.querySelector('i[class*="a-star"] .a-icon-alt');
      // Banner tiles do not use the grid's star markup. They expose one anchor
      // labelled "Rated 3.8 out of 5 stars from 458 reviews" — the only place
      // the review count appears here, and the grid's
      // a[aria-label$="ratings"] selector finds nothing in these tiles.
      var ariaEl = t.querySelector('[aria-label*="out of 5 stars"]');
      var img = t.querySelector('img');
      var title = img ? (img.getAttribute('alt') || '') : '';
      if (!title) title = (t.innerText || '').split('\\n')[0] || '';
      out.push({
        asin: asin,
        title: title.replace(/^Sponsored Ad\\s*-\\s*/i, '').trim() || null,
        price: priceEl ? (priceEl.textContent || '').trim() || null : null,
        ratingText: ratingEl ? (ratingEl.textContent || '').trim() || null : null,
        ratingAria: ariaEl ? ariaEl.getAttribute('aria-label') : null,
        y: Math.round(rect.y + window.scrollY),
        x: Math.round(rect.x + window.scrollX)
      });
    }
  }
  return out;
})()`;

/** A product with its page offset, used only for ordering. */
export interface PlacedProduct extends Product {
  y: number;
  x: number;
}

export async function extractSponsoredBrands(page: Page): Promise<PlacedProduct[]> {
  const raw = (await page.evaluate(SPONSORED_BRANDS_SCRIPT)) as Array<{
    asin: string;
    title: string | null;
    price: string | null;
    ratingText: string | null;
    ratingAria: string | null;
    y: number;
    x: number;
  }>;

  return raw.map((r) => {
    // Two banner creatives word this differently — both must be handled:
    //   "Rated 3.8 out of 5 stars from 458 reviews"
    //   "Rated 3.9 out of 5 stars by 5357 reviews. Go to review section"
    const aria = r.ratingAria ?? '';
    const ratingMatch = aria.match(/([\d.]+)\s*out of\s*5\s*stars/i);
    const reviewMatch = aria.match(/(?:from|by)\s+([\d,]+)\s+review/i);

    return {
      position: 0, // assigned after merging into page order
      asin: r.asin,
      isSponsored: true,
      title: r.title,
      price: r.price,
      rating: ratingMatch ? parseFloatSafe(ratingMatch[1]) : parseFloatSafe(r.ratingText),
      reviewCount: reviewMatch ? parseIntSafe(reviewMatch[1]) : null,
      // Amazon renders no delivery estimate inside a banner tile. Left null;
      // the dedupe step fills it in when the same ASIN also has a grid card.
      deliveryText: null,
      deliveryDays: null,
      y: r.y,
      x: r.x,
    };
  });
}

/**
 * Lightweight read of EVERY grid card on the page — asin plus the four fields
 * a banner tile lacks. Used only to backfill banner ads: the main extraction
 * loop stops early once both buckets are full, so a banner product whose grid
 * card sits at position 31 or 60 was previously invisible to enrichment.
 * One DOM read, no navigation.
 */
const CARD_INDEX_SCRIPT = `(() => {
  var out = [];
  var cards = Array.prototype.slice.call(
    document.querySelectorAll('div[data-component-type="s-search-result"]')
  );
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var asin = c.getAttribute('data-asin');
    if (!asin) continue;
    var priceEl = c.querySelector('.a-price .a-offscreen') || c.querySelector('.a-price-whole');
    var ratingEl = c.querySelector('i[class*="a-star"] .a-icon-alt');
    var revEl = c.querySelector('a[aria-label$="ratings"], a[aria-label$="rating"]');
    var delEl = c.querySelector('[data-cy="delivery-recipe"], .udm-primary-delivery-message');
    out.push({
      asin: asin,
      priceText: priceEl ? (priceEl.textContent || '').trim() || null : null,
      ratingText: ratingEl ? (ratingEl.textContent || '').trim() || null : null,
      reviewAria: revEl ? revEl.getAttribute('aria-label') : null,
      deliveryText: delEl ? (delEl.innerText || delEl.textContent || '').trim() || null : null
    });
  }
  return out;
})()`;

export interface CardFacts {
  price: string | null;
  rating: number | null;
  reviewCount: number | null;
  deliveryText: string | null;
  deliveryDays: number | null;
}

/** asin -> facts, for every card on the page (not just the scanned ones). */
export async function buildCardIndex(page: Page): Promise<Map<string, CardFacts>> {
  const rows = (await page.evaluate(CARD_INDEX_SCRIPT)) as Array<{
    asin: string;
    priceText: string | null;
    ratingText: string | null;
    reviewAria: string | null;
    deliveryText: string | null;
  }>;

  const index = new Map<string, CardFacts>();
  for (const r of rows) {
    // Keep the first (highest-ranked) card for an ASIN.
    if (index.has(r.asin)) continue;
    index.set(r.asin, {
      price: r.priceText,
      rating: parseFloatSafe(r.ratingText),
      reviewCount: parseIntSafe(r.reviewAria),
      deliveryText: r.deliveryText,
      deliveryDays: parseDeliveryDays(r.deliveryText),
    });
  }
  return index;
}

/**
 * Last resort for a banner ad whose product appears nowhere in the grid: open
 * its product page and read the delivery promise (plus price/rating/reviews if
 * they are still missing). Costs one navigation per ASIN, so callers should
 * only use it for products that actually make the reported buckets.
 */
const PRODUCT_PAGE_SCRIPT = `(() => {
  var pick = function (sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (el) {
        var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t) return t;
      }
    }
    return null;
  };
  var priceEl = document.querySelector('#corePrice_feature_div .a-offscreen')
    || document.querySelector('#priceblock_ourprice')
    || document.querySelector('.a-price .a-offscreen');
  var ratingEl = document.querySelector('#acrPopover');
  // Did the product page actually load? Distinguishes "no reviews exist" from
  // "we failed to read the page", which must stay null rather than become 0.
  var loaded = !!document.querySelector('#productTitle');
  var reviewBlock = document.querySelector('#averageCustomerReviews')
    || document.querySelector('#acrCustomerReviewText')
    || document.querySelector('#acrPopover');
  return {
    delivery: pick([
      '#mir-layout-DELIVERY_BLOCK',
      '#deliveryBlockMessage',
      '#delivery-block-ubb-udm-message',
      '#fast-track-message',
      '[data-csa-c-delivery-time]'
    ]),
    price: priceEl ? (priceEl.textContent || '').trim() : null,
    ratingTitle: ratingEl ? ratingEl.getAttribute('title') : null,
    reviewText: pick(['#acrCustomerReviewText']),
    // Page rendered fine but carries no review UI at all -> genuinely 0 reviews.
    confirmedNoReviews: loaded && !reviewBlock
  };
})()`;

export async function fetchProductFacts(
  page: Page,
  domain: string,
  asin: string,
): Promise<CardFacts | null> {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    await page.goto(`https://${host}/dp/${asin}`, { waitUntil: 'domcontentloaded' });
    const r = (await page.evaluate(PRODUCT_PAGE_SCRIPT)) as {
      delivery: string | null;
      price: string | null;
      ratingTitle: string | null;
      reviewText: string | null;
      confirmedNoReviews: boolean;
    };
    const reviewCount = parseIntSafe(r.reviewText);
    return {
      price: r.price,
      rating: parseFloatSafe(r.ratingTitle),
      // A brand-new listing with no reviews is 0, not unknown — and 0 is a
      // value the backend can store, where null gets the row discarded.
      // Rating stays null: a product with no reviews has NO rating, and 0
      // would assert zero stars, which is a different and false claim.
      reviewCount: reviewCount !== null ? reviewCount : r.confirmedNoReviews ? 0 : null,
      deliveryText: r.delivery,
      deliveryDays: parseDeliveryDays(r.delivery),
    };
  } catch {
    return null;
  }
}
