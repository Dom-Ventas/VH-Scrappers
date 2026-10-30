import { config } from '../config';
import { authFetch } from './auth';
import { ScrapedResult } from '../types';

/**
 * POST one product page's result to VentaWiz:
 * { store_id, product_ids, rating, rating_count, critical_reviews: { reviews },
 *   aplus_content, delivery_promise_days }.
 *
 * All or nothing on the backend: a 404 means a product id is not a focused
 * listing of that store, and nothing was stored — the body says which.
 */
export async function postScrapedResult(
  result: ScrapedResult
): Promise<void> {

  const res = await authFetch(
    config.resultsApiUrl,
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json'
      },

      body:
        JSON.stringify(result)
    }
  );

  if (!res.ok) {
    const body =
      await res.text().catch(() => '');

    throw new Error(
      `postScrapedResult ${res.status} ${body}`
    );
  }
}
