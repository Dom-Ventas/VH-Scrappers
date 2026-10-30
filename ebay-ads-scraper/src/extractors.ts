import { Locator } from 'playwright';
import { MarketplaceConfig } from './marketplaces';
import { Product } from './types';
import { formatPrice, parseEbayPrice, parseRating, parseReviewCount, pickDelivery } from './util';

/**
 * Selectors are kept here so they're easy to update when eBay changes its DOM.
 *
 * eBay's search page (2025+ "s-card" layout, the same on every eBay site) puts
 * each result in `ul.srp-results > li.s-card[data-listingid]`, with stable
 * `s-card__*` / `su-styled-text` class names and screen-reader `.clipped`
 * spans that repeat values as plain text.
 *
 * Verified on www.ebay.com, www.ebay.de and www.ebay.co.uk, 2026-10-14
 * (see scripts/check-sponsored.ts).
 */
export const SELECTORS = {
  /**
   * Every result card, in page order. Scoped to the results list on purpose:
   * eBay also plants hidden decoy cards (`div.s-clipped[aria-hidden] > li`,
   * titled "Shop on eBay", linking to /itm/123456) OUTSIDE the list for
   * scrapers that match `li.s-card` page-wide.
   */
  resultCard: 'ul.srp-results > li[data-listingid]',
  /** Full product name; the `.clipped` sibling is "Opens in a new window or tab". */
  title: '.s-card__title',
  /** The selling price — the first one is the lower bound of a variation range. */
  price: '.s-card__price',
  /** "4.0 out of 5 stars." — screen-reader text inside the star widget. */
  rating: '.x-star-rating',
  /** "2 product ratings" next to the stars. Catalogue-level; most cards have none. */
  reviewCount: '.s-card__reviews-count',
  /** Every short row under the price: format, delivery, location, "sold", seller. */
  attributeRows: '.s-card__attribute-row',
  /**
   * The ad label slot. eBay renders "Sponsored" ("Anzeige" on ebay.de) here as
   * an SVG background image and plants the SAME element on organic cards with
   * the text positioned off-canvas — see SPONSORED_PROBE below.
   */
  sponsoredSlot: '.s-card__sep',
} as const;

/**
 * Browser-side sponsored check, run against one card.
 *
 * eBay obfuscates the ad label against exactly this kind of scraper. Every
 * card — ad or organic — carries the same `.s-card__sep > b` element with:
 *   - an inline `background-image: url(data:image/svg+xml;base64,…)` whose
 *     <text> spells "Sponsored" with homoglyphs and bidi marks ("Sрonsor⁧ed");
 *   - a transparent decoy span reading "derosnopS";
 *   - `aria-labelledby` ids that resolve to "Sponsored", "SponsoredSponsored"
 *     or nothing, uncorrelated with whether the card is an ad (agreed with the
 *     visible label on only 15/30 cards of one verification query).
 * The ONLY difference a human sees is where the SVG draws its text: on an ad
 * the x/dx/translate offsets net to about (0, 12) inside the 65×15 box; on an
 * organic card they net to about (-46, 39) — off-canvas, nothing painted.
 *
 * So the check renders what a human would see: it draws the label's SVG onto
 * a canvas the size of the element and counts painted pixels. That survives
 * eBay reshuffling attribute names, offsets or glyphs, because it asks the
 * browser rather than re-implementing SVG layout. If the canvas cannot be read
 * it falls back to summing the offsets itself.
 *
 * A plain-text "Sponsored"/"Anzeige" node that is actually painted (non-zero
 * size, non-transparent colour) is also accepted, for the older layout.
 *
 * Kept as a string so the bundler cannot inject helpers (tsx's `__name`) that
 * do not exist in the page.
 */
const SPONSORED_PROBE = `async (card) => {
  const LABEL = /^(?:sponsored|anzeige|gesponsert|sponsoris[ée]|sponsorizzato|patrocinado)$/i;
  const HOMOGLYPHS = { '\\u0405': 'S', '\\u0455': 's', '\\u0440': 'p', '\\u0420': 'P', '\\u043e': 'o', '\\u041e': 'O',
    '\\u0435': 'e', '\\u0415': 'E', '\\u0430': 'a', '\\u0410': 'A', '\\u0456': 'i', '\\u0406': 'I', '\\u0441': 'c',
    '\\u0421': 'C', '\\u0501': 'd', '\\u0433': 'r', '\\u0445': 'x', '\\u0443': 'y', '\\u0437': 'z', '\\u0417': 'Z' };
  const clean = (t) => (t || '').replace(/[\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u061c\\ufeff]/g, '')
    .replace(/./g, (c) => HOMOGLYPHS[c] || c).trim();
  const result = { sponsored: false, method: 'none', labels: [] };

  const decodeSvg = (style) => {
    const m = style.match(/url\\(\\s*["']?data:image\\/svg\\+xml(;base64)?,([^"')]+)/);
    if (!m) return null;
    try {
      if (m[1]) {
        const bin = atob(m[2]);
        return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      }
      return decodeURIComponent(m[2]);
    } catch (e) { return null; }
  };

  const paintedPixels = async (svg, w, h) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  };

  const offsetsOnCanvas = (svg, w, h) => {
    const text = svg.match(/<text\\b([^>]*)>/i);
    if (!text) return false;
    const attr = (k) => {
      const m = text[1].match(new RegExp('\\\\s' + k + "\\\\s*=\\\\s*['\\"](-?[\\\\d.]+)"));
      return m ? parseFloat(m[1]) : 0;
    };
    const t = text[1].match(/translate\\(\\s*(-?[\\d.]+)[\\s,]+(-?[\\d.]+)/);
    const x = attr('x') + attr('dx') + (t ? parseFloat(t[1]) : 0);
    const y = attr('y') + attr('dy') + (t ? parseFloat(t[2]) : 0);
    return x > -4 && x < w && y > 0 && y <= h + 4;
  };

  const els = [...card.querySelectorAll('[style*="svg+xml"]')];
  for (const el of els) {
    const svg = decodeSvg(el.getAttribute('style') || '');
    if (!svg) continue;
    const words = clean(svg.replace(/<[^>]+>/g, ''));
    const inSlot = !!el.closest('.s-card__sep');
    if (!LABEL.test(words) && !inSlot) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const shown = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0;
    let painted = null;
    let method = 'canvas';
    try {
      painted = shown ? (await paintedPixels(svg, r.width, r.height)) > 10 : false;
    } catch (e) {
      method = 'offsets';
      painted = shown && offsetsOnCanvas(svg, r.width, r.height);
    }
    result.labels.push({ words, painted, method });
    if (painted) { result.sponsored = true; result.method = method; }
  }
  if (result.sponsored) return result;

  for (const el of card.querySelectorAll('span, div, b')) {
    if (el.children.length > 0 || !LABEL.test(clean(el.textContent))) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const color = cs.color.match(/rgba?\\(([^)]+)\\)/);
    const alpha = color && color[1].split(',').length === 4 ? parseFloat(color[1].split(',')[3]) : 1;
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 && alpha > 0) {
      result.sponsored = true;
      result.method = 'text';
      return result;
    }
  }
  return result;
}`;

export interface SponsoredProbe {
  sponsored: boolean;
  /** Which signal decided: "canvas", "offsets", "text" or "none". */
  method: string;
  labels: { words: string; painted: boolean | null; method: string }[];
}

/**
 * Run a browser-side function, given as source text, against one card. The
 * source is compiled by the page's own evaluator (not `eval`, which eBay's CSP
 * would refuse) and then called with the card element.
 */
export async function evaluateOnCard<T>(card: Locator, source: string): Promise<T> {
  const el = await card.elementHandle({ timeout: 5_000 });
  if (!el) throw new Error('card is not attached');
  const fn = await card.page().evaluateHandle(source);
  try {
    return (await fn.evaluate((f, node) => (f as unknown as (n: unknown) => unknown)(node), el)) as T;
  } finally {
    await fn.dispose().catch(() => {});
    await el.dispose().catch(() => {});
  }
}

/** Full sponsored probe for one card — what scripts/check-sponsored.ts prints. */
export async function probeSponsored(card: Locator): Promise<SponsoredProbe> {
  try {
    return await evaluateOnCard<SponsoredProbe>(card, SPONSORED_PROBE);
  } catch (err) {
    console.warn('[SPONSORED] probe failed:', err instanceof Error ? err.message : err);
    return { sponsored: false, method: 'error', labels: [] };
  }
}

/**
 * Sponsored check on its own, so the scrape loop can re-run it after a delay
 * without re-extracting every other field.
 */
export async function detectSponsored(card: Locator): Promise<boolean> {
  return (await probeSponsored(card)).sponsored;
}

/**
 * Pull eBay's item number out of a listing href.
 *
 *   https://www.ebay.com/itm/405662453606?_skw=…        -> 405662453606
 *   https://www.ebay.de/itm/Some-Title/358831537533     -> 358831537533
 */
export function itemIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

async function firstText(card: Locator, selector: string): Promise<string | null> {
  try {
    const loc = card.locator(selector).first();
    if ((await loc.count()) > 0) {
      const text = (await loc.innerText({ timeout: 2_000 })).trim();
      if (text) return text;
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
 * The listing title: the title's visible spans with the screen-reader
 * `.clipped` "Opens in a new window or tab" left out. A "NEW LISTING" badge
 * sits in its own span, so the longest span is the name.
 */
async function titleOf(card: Locator): Promise<string | null> {
  try {
    const spans = await card
      .locator(`${SELECTORS.title} span:not(.clipped)`)
      .allInnerTexts();
    const best = spans.map((s) => s.replace(/\s+/g, ' ').trim()).sort((a, b) => b.length - a.length)[0];
    if (best) return best;
  } catch {
    // fall through
  }
  const whole = await firstText(card, SELECTORS.title);
  return whole
    ? whole
        .replace(/\n?(?:Opens in a new window or tab|Wird in neuem Fenster oder Tab geöffnet)\s*$/i, '')
        .replace(/^(?:NEW LISTING|NEUES ANGEBOT)\s*/i, '')
        .trim() || null
    : null;
}

export async function extractProduct(
  card: Locator,
  position: number,
  marketplace: MarketplaceConfig,
): Promise<Product> {
  // eBay's item number: the card's `data-listingid`, cross-checked against the
  // /itm/<id> link. The decoy cards carry a 16-digit listing id and link to
  // /itm/123456, so both the shape check and the link must agree.
  let itemId: string | null = null;
  try {
    const raw = (await card.getAttribute('data-listingid'))?.trim();
    if (raw && /^\d{9,15}$/.test(raw)) itemId = raw;
  } catch {
    itemId = null;
  }
  if (!itemId) {
    const href = await card
      .locator('a[href*="/itm/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    itemId = itemIdFromHref(href);
  }

  const isSponsored = await detectSponsored(card);
  const text = await cardText(card);
  const title = await titleOf(card);

  // Price: the first `.s-card__price` (the lower bound of "$8.89 to $10.49");
  // the struck-through list price has its own class and is never matched.
  let amount = parseEbayPrice(await firstText(card, SELECTORS.price), marketplace.decimalComma);
  if (amount === null) {
    const rows = await card.locator(SELECTORS.attributeRows).allInnerTexts().catch(() => [] as string[]);
    amount = parseEbayPrice(rows[0], marketplace.decimalComma);
  }
  const price = formatPrice(amount, marketplace.currency);

  let rating = parseRating(await firstText(card, SELECTORS.rating));
  if (rating === null) rating = parseRating(text.match(/[^\n]*(?:out of|von) 5[^\n]*/i)?.[0]);

  let reviewCount = parseReviewCount(await firstText(card, SELECTORS.reviewCount));
  if (reviewCount === null) reviewCount = parseReviewCount(text);

  let rows: string[] = [];
  try {
    rows = await card.locator(SELECTORS.attributeRows).allInnerTexts();
  } catch {
    rows = [];
  }
  let delivery = pickDelivery(rows);
  if (!delivery.deliveryText) delivery = pickDelivery(text.split('\n'));

  return {
    position,
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
