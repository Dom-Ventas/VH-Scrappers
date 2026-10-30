import { Locator } from 'playwright';
import { Product } from './types';
import { formatPrice, parseIntSafe, parseRating, parseReviewCount, parseWalmartPrice, pickDelivery } from './util';

/**
 * Selectors are kept here so they're easy to update when Walmart changes its DOM.
 *
 * Walmart's search page is a friendly target: every product tile is a
 * `[data-item-id]` div with `data-testid` / `data-automation-id` /
 * `data-test-id` hooks on the fields that matter, plus a screen-reader line
 * per field that repeats the value as plain text. Class names (`ld_Ec`,
 * `wcp-rating_star__mfA6I`, `f6 f5-l`) are build hashes or Tachyons utilities —
 * never select on them. Each field reads a semantic hook first and falls back
 * to the tile's own text.
 *
 * Verified on www.walmart.com, 2026-10-13, "bluetooth headphones": 52 tiles,
 * every signal below agreed tile-for-tile (see scripts/check-sponsored.ts).
 */
export const SELECTORS = {
  /**
   * The results grid. Scoping every card selector to it is what keeps the
   * "Sponsored by <brand>" banner at the top of the page OUT of the results:
   * its product tiles are `[data-item-id]` too, but sit above the stack and
   * link through `plmt=sb-search-top` — a Sponsored Brands placement, which
   * VentaWiz explicitly does not count ("only sponsored products in the grid
   * compete with our listing"). A page can hold more than one stack (an ad
   * module splits them); DOM order across stacks is page order.
   */
  resultStack: '[data-testid="item-stack"]',
  /** Every product tile in the grid, in page order. */
  resultCard: '[data-testid="item-stack"] [data-item-id]',
  /**
   * The tile's main link. `link-identifier` holds Walmart's numeric item id;
   * the href is `/ip/<slug>/<itemId>` on an organic tile and an
   * `/sp/track?...&rd=<encoded /ip/ url>` ad-click redirect on a sponsored one.
   */
  mainLink: 'a[link-identifier]',
  /**
   * Sponsored detection — three independent signals, any one is enough:
   *   - the "Sponsored" tag container (`data-test-id`), server-rendered;
   *   - a node whose ENTIRE text is "Sponsored" (`:text-is` cannot match a
   *     title that merely contains the word);
   *   - the main link going through Walmart's ad-click tracker `/sp/track?`
   *     (read in code, see isAdHref()).
   * Unlike noon's SVG "Ad" pill, Walmart's label IS a real text node, so the
   * text check works here. 12 of 52 tiles flagged on the verification query,
   * all three signals agreeing on every tile.
   */
  sponsoredTag: '[data-test-id="gpt-sponsored-tag-container"]',
  sponsoredText: ':is(div,span):text-is("Sponsored")',
  /** Full product name. The image alt and the link's <h3> repeat it. */
  title: '[data-automation-id="product-title"]',
  titleImageAlt: 'img[data-testid="productTileImage"][alt]',
  titleHeading: 'a[link-identifier] h3',
  /**
   * Price. The screen-reader line prints the amount whole ("Price Now $20.99
   * Was $159.95 Options from $14.00"); the visible price is split into "$",
   * "20", "99" spans and is only the fallback. `ugpp-was-price` is the
   * struck-through pre-reduction price and is excluded from the fallback.
   */
  priceA11y: '[data-testid="unified-global-product-price-a11y-text"]',
  priceVisual: '[data-testid="unified-global-product-price"]',
  priceWas: '[data-testid="ugpp-was-price"]',
  /** "4.6 out of 5 stars" — the screen-reader text inside the rating widget. */
  ratingA11y: '[data-testid="product-ratings"] span',
  /** One <svg data-testid="star-filled|star-halfFilled|star-empty"> per star. */
  ratingStars: '[data-testid="product-ratings"] svg[data-testid^="star-"]',
  /** Bare count next to the stars; `data-value` holds it unformatted. */
  reviewCount: '[data-testid="product-reviews"]',
  /** Every badge line under the title: delivery promise, Walmart+, flags. */
  badges: '[data-testid="badgeTagComponent"]',
} as const;

/** Walmart's ad-click tracker — the main link of every sponsored tile. */
export function isAdHref(href: string | null | undefined): boolean {
  return !!href && /\/sp\/track\?/.test(href);
}

/**
 * Pull Walmart's numeric item id out of a product href.
 *
 *   /ip/Apple-AirPods-4/11381374703?classType=REGULAR           -> 11381374703
 *   /sp/track?...&rd=https%3A%2F%2Fwww.walmart.com%2Fip%2F…%2F9744661583%3F… -> 9744661583
 */
export function itemIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // keep the raw href
  }
  const m = decoded.match(/\/ip\/(?:[^/?#]+\/)?(\d{5,})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

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

async function firstAttr(card: Locator, selector: string, attr: string): Promise<string | null> {
  try {
    const loc = card.locator(selector).first();
    if ((await loc.count()) > 0) {
      const value = await loc.getAttribute(attr);
      if (value && value.trim()) return value.trim();
    }
  } catch {
    // caller falls through to its next source
  }
  return null;
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
 * Sponsored check on its own, so the scrape loop can re-run it after a delay
 * without re-extracting every other field.
 */
export async function detectSponsored(card: Locator): Promise<boolean> {
  for (const sel of [SELECTORS.sponsoredTag, SELECTORS.sponsoredText]) {
    try {
      if ((await card.locator(sel).count()) > 0) return true;
    } catch {
      // try the next signal
    }
  }
  return isAdHref(await firstAttr(card, SELECTORS.mainLink, 'href'));
}

/** Count the star icons: filled = 1, half = 0.5. null when the tile has none. */
async function ratingFromStars(card: Locator): Promise<number | null> {
  try {
    const stars = card.locator(SELECTORS.ratingStars);
    const n = await stars.count();
    if (n === 0) return null;
    let rating = 0;
    for (let i = 0; i < n; i++) {
      const type = (await stars.nth(i).getAttribute('data-testid')) || '';
      if (/half/i.test(type)) rating += 0.5;
      else if (/filled|full/i.test(type)) rating += 1;
    }
    return rating;
  } catch {
    return null;
  }
}

/**
 * The visible price, read from its split spans with the struck-through "was"
 * price removed: ["Now", "$", "99", "00", "Options from $68.00"] -> 99.00.
 */
async function priceFromVisual(card: Locator): Promise<number | null> {
  try {
    const loc = card.locator(SELECTORS.priceVisual).first();
    if ((await loc.count()) === 0) return null;
    const tokens = await loc.evaluate((el, wasSel) => {
      return Array.from(el.querySelectorAll('span'))
        .filter((s) => s.children.length === 0 && !s.closest(wasSel))
        .map((s) => (s.textContent || '').trim())
        .filter(Boolean);
    }, SELECTORS.priceWas);
    const at = tokens.indexOf('$');
    if (at < 0 || !/^\d[\d,]*$/.test(tokens[at + 1] || '')) return null;
    const whole = tokens[at + 1].replace(/,/g, '');
    const cents = /^\d{2}$/.test(tokens[at + 2] || '') ? tokens[at + 2] : '00';
    const n = parseFloat(`${whole}.${cents}`);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function extractProduct(
  card: Locator,
  position: number,
  currency: string,
): Promise<Product> {
  // Walmart's product id (wpid): the tile's `data-item-id`, an upper-case
  // alphanumeric code on ads and organic tiles alike. The Sponsored Brands
  // banner tiles carry a NUMERIC data-item-id instead — they are excluded by
  // the grid scoping, and the shape check below keeps one out regardless.
  let wpid: string | null = null;
  try {
    const raw = (await card.getAttribute('data-item-id'))?.trim().toUpperCase();
    if (raw && /^(?=.*[A-Z])[A-Z0-9]{8,20}$/.test(raw)) wpid = raw;
  } catch {
    wpid = null;
  }

  // Walmart's numeric item id. Three sources that agreed on 52/52 verified
  // tiles, tried in order: the tile's `data-dca-id`, the main link's
  // `link-identifier`, and the id in the (possibly ad-redirect-wrapped) href.
  let itemId: string | null = null;
  try {
    const dca = (await card.getAttribute('data-dca-id'))?.trim();
    if (dca && /^\d+$/.test(dca)) itemId = dca;
  } catch {
    itemId = null;
  }
  const href = await firstAttr(card, SELECTORS.mainLink, 'href');
  if (!itemId) {
    const linkId = await firstAttr(card, SELECTORS.mainLink, 'link-identifier');
    if (linkId && /^\d+$/.test(linkId)) itemId = linkId;
  }
  if (!itemId) itemId = itemIdFromHref(href);

  const isSponsored = await detectSponsored(card);

  const text = await cardText(card);

  // Title: the automation-id node carries the full name. Fall back to the
  // product image's alt, then the link's screen-reader heading, which appends
  // ", Price …" and is trimmed back to the name.
  let title = await firstText(card, [SELECTORS.title]);
  if (!title) title = await firstAttr(card, SELECTORS.titleImageAlt, 'alt');
  if (!title) {
    const heading = await firstText(card, [SELECTORS.titleHeading]);
    if (heading) title = heading.replace(/,\s*Price\b.*$/i, '').trim() || null;
  }

  // Price: screen-reader line first, visible spans second, card text last.
  let amount = parseWalmartPrice(await firstText(card, [SELECTORS.priceA11y]));
  if (amount === null) amount = await priceFromVisual(card);
  if (amount === null) amount = parseWalmartPrice(text.match(/(?:^|\n)\s*(?:Price|Now|current price)\b[^\n]*/i)?.[0]);
  const price = formatPrice(amount, currency);

  // Rating: "4.6 out of 5 stars", else count the star icons.
  let rating = parseRating(await firstText(card, [SELECTORS.ratingA11y]));
  if (rating === null) rating = parseRating(text.match(/[^\n]*out of 5[^\n]*/i)?.[0]);
  if (rating === null) rating = await ratingFromStars(card);
  if (rating !== null && (rating < 0 || rating > 5)) rating = null;

  // Review count: the `data-value` attribute is the unformatted number; the
  // node text and the "… 86071 reviews" screen-reader line back it up.
  let reviewCount = parseIntSafe(await firstAttr(card, SELECTORS.reviewCount, 'data-value'));
  if (reviewCount === null) reviewCount = parseReviewCount(await firstText(card, [SELECTORS.reviewCount]));
  if (reviewCount === null) reviewCount = parseReviewCount(text.match(/[^\n]*\breviews?\b[^\n]*/i)?.[0]);

  // Delivery: every badge line, then the whole card's lines as a backstop.
  let badgeLines: string[] = [];
  try {
    badgeLines = await card.locator(SELECTORS.badges).allInnerTexts();
  } catch {
    badgeLines = [];
  }
  let delivery = pickDelivery(badgeLines);
  if (!delivery.deliveryText) delivery = pickDelivery(text.split('\n'));

  return {
    position,
    wpid,
    itemId,
    isSponsored,
    title,
    price,
    rating,
    reviewCount,
    deliveryText: delivery.deliveryText,
    deliveryDays: delivery.deliveryDays,
  };
}
