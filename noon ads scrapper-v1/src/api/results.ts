import { config } from '../config';
import { ScrapedResult } from '../types';

/**
 * POST a single scraped result (one query + up to N products) to your backend.
 * The body matches the ScrapedResult shape — backend should accept
 * { emailId, profileId, queryId, shortCode, searchTerm, scrapedAt, products }.
 *
 * Same contract as the Amazon and Flipkart scrappers with one deliberate
 * difference: the per-product identifier is sent as `sku`, not their legacy
 * `asin`. See the note on Product.sku in src/types.ts.
 */
export async function postScrapedResult(result: ScrapedResult): Promise<void> {
  if (!config.resultsApiUrl) {
    throw new Error(
      'RESULTS_API_URL is not set. Add it to your .env file.',
    );
  }

  const res = await fetch(config.resultsApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiToken}`,
    },
    body: JSON.stringify(result),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`postScrapedResult ${res.status} ${res.statusText} ${text}`);
  }
}
