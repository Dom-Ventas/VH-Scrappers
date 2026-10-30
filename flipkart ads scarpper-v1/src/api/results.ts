import { config } from '../config';
import { authFetch } from './auth';
import { ScrapedResult } from '../types';

/** What the backend did with a posted result. */
export type PostOutcome =
  | { status: 'stored'; sponsored: number; organic: number }
  /** 409: this store and term already have a result today. Counts as success. */
  | { status: 'already-stored' };

/**
 * POST one search's result to the backend:
 *   { store_id, search_term, products: [ { position, mp_product_id, is_sponsored, ... } ] }
 *
 * 201 -> { id, store_id, search_term, sponsored, organic, created_at }.
 * 409 means a result for this store and term was already stored today (e.g. a
 * retry after a timeout) and is reported as success, not thrown.
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
    return { status: 'already-stored' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`postScrapedResult ${res.status} ${res.statusText} ${text}`);
  }
  const data = (await res.json().catch(() => ({}))) as { sponsored?: number; organic?: number };
  return { status: 'stored', sponsored: data.sponsored ?? 0, organic: data.organic ?? 0 };
}
