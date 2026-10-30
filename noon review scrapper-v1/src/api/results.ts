import { config } from '../config';
import { authFetch } from './auth';
import { ScrapedResult } from '../types';

/**
 * POST one product page's result to VentaWiz (/v1/scrapper/reviews):
 * { store_id, product_ids, rating, rating_count, critical_reviews: { reviews },
 *   aplus_content, delivery_promise_days, ...noon extras }.
 *
 * A 404 means a product id is not a focused listing of that store; it is
 * thrown with the body text like any other non-2xx, so the item is [FAIL]ed.
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

      body: JSON.stringify(result)
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `postScrapedResult ${res.status} ${body}`
    );
  }
}
