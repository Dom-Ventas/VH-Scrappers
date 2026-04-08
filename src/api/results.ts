import { config } from '../config';
import { ScrapedResult } from '../types';

/**
 * POST a single scraped result (one query + up to 5 products) to your backend.
 *
 * TODO: Replace the body with your real API call.
 *
 * Example wiring:
 *
 *   const res = await fetch(config.resultsApiUrl, {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       Authorization: `Bearer ${config.apiToken}`,
 *     },
 *     body: JSON.stringify(result),
 *   });
 *   if (!res.ok) throw new Error(`postScrapedResult ${res.status}`);
 */
export async function postScrapedResult(result: ScrapedResult): Promise<void> {
  if (!config.resultsApiUrl) {
    console.warn(
      `[postScrapedResult] RESULTS_API_URL not set — logging payload instead. Query="${result.searchTerm}" products=${result.products.length}`,
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(
    'postScrapedResult is not yet wired. Edit src/api/results.ts and send `result` to your API.',
  );
}
