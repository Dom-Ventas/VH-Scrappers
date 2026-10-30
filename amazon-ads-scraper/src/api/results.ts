import { config } from '../config';
import { authFetch } from './auth';
import { ScrapedResult } from '../types';

export interface PostOutcome {
  /** 409: a result for this store + term was already stored today (UTC). */
  alreadyStored: boolean;
  /** What the backend stored (201 only). */
  sponsored?: number;
  organic?: number;
}

/**
 * POST one search's result to VentaWiz:
 * { store_id, search_term, products: [{ position, mp_product_id, is_sponsored,
 *   price, rating, review_count, delivery_days, title }] }.
 *
 * An empty `products` is still posted — "no ads today" is a result and is
 * what marks the term as run. A 409 means the term was already stored today
 * (e.g. a retry after a timeout) and counts as success.
 */
export async function postScrapedResult(result: ScrapedResult): Promise<PostOutcome> {
  if (!config.resultsApiUrl) {
    throw new Error(
      'RESULTS_API_URL is not set. Add it to your .env file.',
    );
  }

  const res = await authFetch(config.resultsApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
  if (res.status === 409) {
    return { alreadyStored: true };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`postScrapedResult ${res.status} ${res.statusText} ${text}`);
  }
  const body = (await res.json().catch(() => ({}))) as { sponsored?: number; organic?: number };
  return { alreadyStored: false, sponsored: body.sponsored, organic: body.organic };
}
