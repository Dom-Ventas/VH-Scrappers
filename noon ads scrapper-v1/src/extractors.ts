import { Locator } from 'playwright';
import { Product } from './types';
import { parseFloatSafe, parseReviewCount, parseDeliveryDays } from './util';

/**
 * Selectors are kept here so they're easy to update when noon changes its DOM.
 *
 * Noon is a much friendlier target than Flipkart. It ships stable, semantic
 * `data-qa` hooks (`plp-product-box`, `plp-product-box-name`,
 * `plp-product-box-price`) that survive releases, so the card, title and price
 * are pinned to those rather than to class names. Everything else — rating,
 * review count, delivery — has no data-qa and must go through noon's hashed
 * CSS-module class names (`_textCtr_1r83y_16`, `_countCtr_1r83y_47`), which
 * rotate on every build.
 *
 * The trick that keeps those working: noon's hash is a SUFFIX of a readable
 * module-scoped name, so an attribute-contains match on the readable prefix
 * (`[class*="_countCtr_"]`) survives a rehash where a full class match would
 * not. Every extractor still falls back to parsing the card's own text on top
 * of that — keep both layers.
 */
export const SELECTORS = {
  // Every product tile on the search grid. Stable, semantic, and the same on
  // every storefront and both languages.
  resultCard: '[data-qa="plp-product-box"]',
  /** The grid wrapper — used to wait for results before extracting. */
  resultGrid: '[data-qa="plp-grid"]',
  /**
   * Sponsored detection.
   *
   * READ THIS BEFORE ADDING A TEXT MATCH. Noon marks a paid placement with a
   * small "Ad" pill at the bottom-left of the product image — and that pill is
   * an inline <svg> of vector PATHS, not text:
   *
   *   <div class="_overlayFooter_1m97z_45">
   *     <div class="_container_1xibb_1">
   *       <svg width="20" height="16" viewBox="0 0 21 16">
   *         <rect ... fill="white" fill-opacity="0.7"/>
   *         <path d="M10.488 12H9.34795..." fill="#9BA0B1"/>   <- draws "A" + "d"
   *
   * There is no text node anywhere in it, so `innerText` scans, a raw-HTML
   * search for "sponsor"/"ad", and `:text-is("Ad")` ALL return zero on a page
   * that is 45% ads. This is the same trap Flipkart sets with its "Sponsored"
   * SVG — do not trust a text-based check on either site.
   *
   * Match on structure and geometry instead. Verified on uae-en across
   * "shampoo", "perfume", "protein powder", "laptop" and "diapers": every
   * signal below agreed card-for-card, flagging a consistent 9 of the top 20 on
   * each query.
   *   - `_overlayFooter_ svg[viewBox="0 0 21 16"]`: right place AND the badge's
   *     own geometry. Most precise; independent of the class hash rotating.
   *   - `_imageSection_ svg[viewBox=...]`: same badge if the footer class is
   *     renamed.
   *   - `_overlayFooter_ svg`: structural backstop that survives a badge
   *     redraw. Safe today only because the footer's other two controls
   *     (wishlist, add-to-cart) are <img>, not inline <svg> — so if noon ever
   *     adds an inline-SVG icon there this will match EVERY card. scrapeSearchTerm()
   *     warns loudly when that happens rather than posting a page of false ads.
   *
   * The text/data-qa selectors are kept last purely as forward-compat, in case
   * noon ever ships a real label. They match nothing today.
   *
   * Do NOT add an href match on `o=` or `nav_ctx=`. `o=` is a page-level
   * tracking token echoed into EVERY card's href — it matched all 78 of 78 on
   * "protein powder" and would report the whole page as sponsored. `nav_ctx` is
   * the same trap from the other side: it appeared on exactly 1 of 78 organic
   * cards, so it is noise, not an ad marker. (Flipkart has the identical trap
   * with `ppt=sp` / `fm=organic`.)
   */
  sponsoredBadge: [
    '[class*="_overlayFooter_"] svg[viewBox="0 0 21 16"]',
    '[class*="_imageSection_"] svg[viewBox="0 0 21 16"]',
    '[class*="_overlayFooter_"] svg',
    // Forward-compat only — noon renders no textual ad label today.
    '[data-qa*="sponsor" i]',
    '[data-qa*="promoted" i]',
    '[class*="sponsor" i]',
    '[class*="promoted" i]',
    // `:text-is` requires the element's ENTIRE text to equal the label, so it
    // matches only the badge node — never an ancestor that merely contains the
    // word (a title like "... sponsored by ..." cannot trigger it).
    ':is(div,span,p):text-is("Sponsored")',
    ':is(div,span,p):text-is("Promoted")',
    ':is(div,span,p):text-is("Ad")',
    // Arabic storefronts (uae-ar / saudi-ar) label ads with this word.
    ':is(div,span,p):text-is("إعلان")',
  ],
  /** Full, untruncated product name — noon does not ellipsis-truncate this. */
  title: ['[data-qa="plp-product-box-name"]', 'h2[class*="_title_"]'],
  /**
   * The product image's alt text repeats the full title, so it backstops a
   * data-qa rename. `:not([alt="placeholder"])` skips noon's grey
   * media-placeholder image, which sits in the DOM alongside the real one and
   * would otherwise win the `.first()` race with alt="placeholder".
   */
  titleImageAlt: 'img[alt]:not([alt="placeholder"])',
  /**
   * Selling price ONLY. The price box also holds the struck-through pre-
   * reduction price (`_oldPrice_`) and the discount badge (`_discount_`), both
   * of which must stay out — matching the box itself would yield
   * "95.15 125 23% OFF".
   */
  price: [
    '[data-qa="plp-product-box-price"] [class*="_sellingPrice_"] strong',
    '[data-qa="plp-product-box-price"] [class*="_sellingPrice_"]',
    '[data-qa="plp-product-box-price"] strong',
  ],
  /** The whole price box — text-fallback source when the above all miss. */
  priceBox: '[data-qa="plp-product-box-price"]',
  /**
   * Rating value ("4.3"). No data-qa exists for it. `_textCtr_` is a partial
   * match on a hashed CSS-module class, so it could in principle collide with
   * another component — extractProduct() therefore range-checks the result to
   * 0..5 and drops anything else rather than trusting the selector blindly.
   */
  rating: ['[class*="_textCtr_"]', '[class*="_ratingText_"]'],
  /**
   * Review count. Noon compacts these ("15.8K", "1.6K") — see
   * parseReviewCount(), which is why parseIntSafe() is NOT used here.
   */
  reviewCount: ['[class*="_countCtr_"]', '[class*="_ratingCount_"]'],
  /**
   * Delivery promise. Unlike Flipkart — whose search grid carries no promise at
   * all, leaving both delivery fields permanently null — noon renders it right
   * on the card, so these fields carry real data. Observed shapes:
   * "GET IN 57 MINS" (noon minutes/express), "Get it by 27 Aug", "Get it by
   * Tomorrow". Some cards ship the container empty; firstText() skips empty
   * text so those fall through to the whole-card text scan.
   */
  delivery: [
    '[class*="_additionalInfo_"]',
    '[class*="_estimationText_"]',
    '[class*="_flyoutBadgeCtr_"]',
  ],
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

/**
 * Pick the line of the card that looks most like a delivery promise.
 *
 * A card can carry more than one delivery-ish line, and they are not equally
 * useful: "Free Delivery" is a shipping-COST badge with no date in it, while
 * "Get it by 27 Aug" is the actual promise. Returning whichever came first in
 * DOM order would let the cost badge mask the date and silently null out
 * deliveryDays, so lines that actually parse to a date are preferred and the
 * bare badge is kept only as a last resort (deliveryText is documented as raw
 * audit text, so it is still worth returning something).
 *
 * Both forms coexist once a delivery address is resolved for the session, which
 * is precisely what the first-run flow has the user set up — so this ordering
 * matters in production even though a fresh profile usually sees only one.
 */
function deliveryLineFrom(text: string): string | null {
  const candidates: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // "GET IN 57 MINS" / "Get it by 27 Aug" / "Free Delivery"
    if (/\bget\s+(?:in|it)\b/i.test(trimmed) || /deliver/i.test(trimmed)) {
      candidates.push(trimmed);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.find((c) => parseDeliveryDays(c) !== null) ?? candidates[0];
}

/**
 * Pull noon's SKU out of a product href.
 *
 *   /uae-en/<slug>/N70082559V/p/?nav_ctx=...  ->  N70082559V
 *   /uae-en/<slug>/Z38F7F87F384F17FD4824Z/p/  ->  Z38F7F87F384F17FD4824Z
 *
 * Noon issues two SKU shapes (an "N...A"/"N...V" catalogue id and a longer
 * "Z...Z" hex id); both appear on the same results page, so the pattern matches
 * the path position rather than the id format.
 */
export function skuFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/([A-Za-z0-9]+)\/p(?:\/|\?|$)/);
  return m ? m[1] : null;
}

export async function extractProduct(
  card: Locator,
  position: number,
  currency: string,
): Promise<Product> {
  // Noon's SKU, parsed out of the product href. Posted under the key `sku` —
  // the Amazon and Flipkart scrappers send the same value as `asin`; see the
  // note on Product.sku in types.ts.
  let sku: string | null = null;
  try {
    const href = await card.locator('a[href]').first().getAttribute('href');
    sku = skuFromHref(href);
  } catch {
    sku = null;
  }

  const isSponsored = await hasAnySponsored(card, SELECTORS.sponsoredBadge);

  const text = await cardText(card);

  // Title: the data-qa node carries the full name untruncated. Fall back to the
  // product image's alt text, which repeats it.
  let title = await firstText(card, SELECTORS.title);
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

  // Price is kept as a raw string to match the Amazon/Flipkart scrappers — the
  // backend does its own currency parsing. Noon draws the currency as a glyph
  // with no text content, so the code comes from the marketplace table and is
  // prefixed here; that keeps "AED 165.30" as self-describing as Flipkart's
  // "₹1,299" instead of a bare, unit-less "165.30".
  let priceAmount = await firstText(card, SELECTORS.price);
  if (!priceAmount) {
    // Fallback: first number in the price box. Its text runs
    // "\n95.15\n125\n23% OFF" — selling price first, then the struck-through
    // pre-reduction price and the discount badge, so taking the FIRST match is
    // what keeps the old price out.
    const boxText = await firstText(card, [SELECTORS.priceBox]);
    const m = (boxText || '').match(/[\d][\d,]*(?:\.\d+)?/);
    priceAmount = m ? m[0] : null;
  }
  const price = priceAmount ? `${currency} ${priceAmount}`.trim() : null;

  // The rating strip renders as "4.3" then "15.8K" on consecutive card-text
  // lines, so one regex backstops both fields when the hashed classes rotate.
  const ratingStrip = text.match(/(?:^|\n)\s*([0-5](?:\.\d)?)\s*\n\s*([\d][\d.,]*[KM]?)\s*(?:\n|$)/i);

  let rating = parseFloatSafe(await firstText(card, SELECTORS.rating));
  if (rating === null && ratingStrip) rating = parseFloatSafe(ratingStrip[1]);
  if (rating !== null && (rating < 0 || rating > 5)) rating = null;

  let reviewCount = parseReviewCount(await firstText(card, SELECTORS.reviewCount));
  if (reviewCount === null && ratingStrip) reviewCount = parseReviewCount(ratingStrip[2]);

  let deliveryText = await firstText(card, SELECTORS.delivery);
  if (!deliveryText) deliveryText = deliveryLineFrom(text);
  const deliveryDays = parseDeliveryDays(deliveryText);

  return {
    position,
    sku,
    isSponsored,
    title,
    price,
    rating,
    reviewCount,
    deliveryText,
    deliveryDays,
  };
}
