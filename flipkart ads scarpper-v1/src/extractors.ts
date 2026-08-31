import { Locator } from 'playwright';
import { Product } from './types';
import { parseFloatSafe, parseRatingCount, parseDeliveryDays } from './util';

/**
 * Selectors are kept here so they're easy to update when Flipkart changes its
 * DOM.
 *
 * IMPORTANT: unlike Amazon, Flipkart ships obfuscated, build-hashed class names
 * (`.Nx9bqj`, `._30jeq3`, ...) that rotate every few releases, and it serves
 * three different search layouts (grid, list, image-grid) depending on the
 * category. So each field lists several historical class names AND every
 * extractor falls back to parsing the card's own text. The text fallbacks are
 * what keep this working across a class-name rotation — keep them.
 */
export const SELECTORS = {
  // Every product tile — grid, list, or image-grid — carries the Flipkart PID
  // in data-id. This is by far the most stable hook on the page.
  resultCard: 'div[data-id]',
  /**
   * Sponsored detection. Note that Flipkart does NOT render the word
   * "Sponsored" as text — it ships it as an inline <svg> of vector paths, so
   * any text-based match ( :has-text("Ad"), :text-is("Sponsored") ) silently
   * returns false on every card. Match on structure instead:
   *   - `[data-tkid^="ADVIEW_"]`: the ad-impression tracking wrapper. Present
   *     only on paid placements, semantic rather than cosmetic, and consistent
   *     across categories (8 of the top 20 on both headphones and shoes
   *     searches, in Flipkart's usual paired ad slots). This is the signal.
   *   - `> div[data-tkid^="en_"]`: the card's own tracking id. Paid slots carry
   *     an encrypted "en_..." token; organic ones carry "<uuid>.<PID>.SEARCH".
   *     Independent of ADVIEW and verified to agree with it on every card
   *     across three queries, so it covers an ADVIEW rename.
   *   - `div.IxWX8O`: wrapper around the "Sponsored" SVG. A strict subset of
   *     ADVIEW when present and absent entirely in some categories (0 on
   *     "smart watches" where 7 cards are genuinely ads), so it is a weak
   *     backstop only. Hashed — expect it to rotate.
   *
   * Do NOT add `a[href*="ppt=sp"]`. `ppt`/`ppn` are page-level tracking params
   * echoed into EVERY card's href on some page loads, so it matched all 20
   * results and reported a search as 100% sponsored. Same trap with
   * `fm=organic`, which is also present on every card including the ads.
   */
  sponsoredBadge: [
    '[data-tkid^="ADVIEW_"]',
    '> div[data-tkid^="en_"]',
    'div.IxWX8O',
    // List-layout (laptops, large appliances) renders the label as real text
    // rather than the grid's SVG. `:text-is` requires the element's ENTIRE text
    // to equal "Sponsored", so it matches only the label node — never an
    // ancestor that merely contains the word. Measured 0 false positives across
    // 120 cards spanning 6 queries, 31 of which were genuine ads.
    ':is(div,span):text-is("Sponsored")',
  ],
  /**
   * The title anchor's visible text is ellipsis-truncated ("DSSB Sports
   * Bluetooth Neckband with Sweat Resistant Des..."), so the `title` attribute
   * is the real source — see titleAttrAnchor below, which is tried first.
   */
  title: ['a.pIpigb', 'div.KzDlHZ', 'div._4rR01T', 'a.wjcEIp', 'a.s1Q9rs', 'a.IRpwTa'],
  /** Anchors whose `title` attribute holds the full, untruncated product name. */
  titleAttrAnchor: 'a[title]',
  titleImageAlt: 'img[alt]',
  // hZ3P6w is the selling price; kRYCnD (struck-through MRP) and HQe8jr
  // (discount %) sit next to it and must not be picked up.
  price: ['div.hZ3P6w', 'div.Nx9bqj', 'div._30jeq3', 'div._4b5DiR'],
  // "3.9" followed by an inline star <img>.
  rating: ['div.MKiFS6', 'div.XQDdHH', 'div._3LWZlK'],
  // Flipkart's grid shows a bare parenthesised count — "(19)", "(2,13,109)" —
  // not Amazon's "1,234 Ratings & 56 Reviews". Indian digit grouping is why
  // parseRatingCount() strips separators rather than parsing groups of three.
  reviewCount: ['span.PvbNMB', 'span.Wphh3N', 'span._2_R_DZ'],
  /**
   * KNOWN GAP: unlike Amazon, Flipkart's search grid does not render a delivery
   * promise on the card at all — verified across headphones / laptop /
   * refrigerator / shoes searches, zero "Delivery by ..." strings on the page.
   * That promise only exists on the product detail page, after a pincode is
   * resolved. So `deliveryText` and `deliveryDays` come back null for every
   * product today.
   *
   * The selectors and parseDeliveryDays() are kept wired up because (a) the
   * fields must stay in the payload for contract parity with the Amazon
   * scrapper, and (b) a signed-in session with a saved pincode may surface the
   * strip. Populating them for real means a per-product PDP visit — 20x the
   * requests per query — which is a product decision, not a scraping one.
   */
  delivery: ['div.hCQXW7', 'div._9_Ec-p', 'div._2Tpdn3'],
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

/** Whole-card text, used as the fallback source for every field. */
async function cardText(card: Locator): Promise<string> {
  try {
    return (await card.innerText({ timeout: 3_000 })).trim();
  } catch {
    return '';
  }
}

/** Pick the first line of the card that looks like a delivery promise. */
function deliveryLineFrom(text: string): string | null {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/deliver/i.test(trimmed)) return trimmed;
  }
  return null;
}

export async function extractProduct(card: Locator, position: number): Promise<Product> {
  // Flipkart's PID, e.g. "MOBGTAGPTB3VS24W". Stored in the `asin` field so the
  // payload stays contract-compatible with the Amazon scrapper.
  let asin: string | null = null;
  try {
    asin = (await card.getAttribute('data-id')) || null;
    if (asin && !asin.trim()) asin = null;
  } catch {
    asin = null;
  }

  const isSponsored = await hasAnySponsored(card, SELECTORS.sponsoredBadge);

  const text = await cardText(card);

  // Title: the anchor's `title` attribute carries the full name; its visible
  // text is ellipsis-truncated by CSS. Prefer the attribute, fall back to the
  // layout-specific title node, then to the product image's alt text.
  let title: string | null = null;
  try {
    const anchor = card.locator(SELECTORS.titleAttrAnchor).first();
    if ((await anchor.count()) > 0) {
      const attr = await anchor.getAttribute('title');
      if (attr && attr.trim()) title = attr.trim();
    }
  } catch {
    // fall through to the text-node selectors
  }
  if (!title) title = await firstText(card, SELECTORS.title);
  if (!title) {
    try {
      const img = card.locator(SELECTORS.titleImageAlt).first();
      if ((await img.count()) > 0) {
        const alt = await img.getAttribute('alt');
        if (alt && alt.trim()) title = alt.trim();
      }
    } catch {
      // keep existing title (may be null)
    }
  }

  // Price is kept as the raw string ("₹1,299") to match the Amazon scrapper —
  // the backend does its own currency parsing.
  let price = await firstText(card, SELECTORS.price);
  if (!price) {
    const m = text.match(/₹\s?[\d,]+/);
    price = m ? m[0].replace(/\s/g, '') : null;
  }

  // The rating strip renders as a single "3.9(19)" line in the card text, so
  // one regex backstops both fields when the hashed classes rotate.
  const ratingStrip = text.match(/(?:^|\n)\s*([0-5](?:\.\d)?)\s*\(([\d,]+)\)/);

  let rating = parseFloatSafe(await firstText(card, SELECTORS.rating));
  if (rating === null && ratingStrip) rating = parseFloatSafe(ratingStrip[1]);
  if (rating !== null && (rating < 0 || rating > 5)) rating = null;

  let reviewCount = parseRatingCount(await firstText(card, SELECTORS.reviewCount));
  if (reviewCount === null && ratingStrip) reviewCount = parseRatingCount(ratingStrip[2]);

  let deliveryText = await firstText(card, SELECTORS.delivery);
  if (!deliveryText) deliveryText = deliveryLineFrom(text);
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
