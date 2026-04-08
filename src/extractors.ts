import { Locator } from 'playwright';
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
