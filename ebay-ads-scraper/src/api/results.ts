import { config } from '../config';
import { authFetch } from './auth';
import { Product, ResultProduct, ScrapedResult, StoredResult } from '../types';

/** The backend stores at most five of each kind (comp1–5 / org1–5). */
const PER_KIND = 5;

function ratingOrNull(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 5 ? v : null;
}

function countOrNull(v: number | null): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/**
 * Turn scraped cards into the products array VentaWiz takes: cards with no
 * item number dropped (placeholders the scraper could not read), then up to
 * five sponsored and five organic, in page order. Values the page did not show
 * — or that came out of range — are null, never 0 / -1. eBay's item number
 * goes out as `mp_product_id` (the id VentaWiz keys eBay listings by).
 */
export function toResultProducts(scraped: Product[]): ResultProduct[] {
  const withId = scraped
    .filter((p) => !!p.itemId)
    .sort((a, b) => a.position - b.position);
  const sponsored = withId.filter((p) => p.isSponsored).slice(0, PER_KIND);
  const organic = withId.filter((p) => !p.isSponsored).slice(0, PER_KIND);
  return [...sponsored, ...organic]
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      position: Number.isInteger(p.position) && p.position >= 1 ? p.position : null,
      mp_product_id: p.itemId as string,
      is_sponsored: p.isSponsored,
      price: p.price || null,
      rating: ratingOrNull(p.rating),
      review_count: countOrNull(p.reviewCount),
      delivery_days: countOrNull(p.deliveryDays),
      title: p.title || null,
    }));
}

export interface PostOutcome {
  /** 409: this store + term was already scraped today — treat as success. */
  alreadyStored: boolean;
  /** The 201 body, when the backend returned one. */
  stored: StoredResult | null;
}

/**
 * POST one search's result to VentaWiz (/v1/scrapper/search-term-results).
 * Body: { store_id, search_term, products }. An empty `products` is valid —
 * "no ads today" is still a result and must be stored.
 */
export async function postScrapedResult(result: ScrapedResult): Promise<PostOutcome> {
  if (!config.resultsApiUrl) {
    throw new Error(
      'RESULTS_API_URL is not set. Add it to your .env file.',
    );
  }

  const res = await authFetch(config.resultsApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(result),
  });
  if (res.status === 409) {
    return { alreadyStored: true, stored: null };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`postScrapedResult ${res.status} ${res.statusText} ${text}`);
  }
  const stored = (await res.json().catch(() => null)) as StoredResult | null;
  return { alreadyStored: false, stored };
}
