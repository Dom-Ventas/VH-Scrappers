import { config } from '../config';
import { ScrapedResult } from '../types';

/**
 * POST a single scraped result (one query + up to N products) to your backend.
 * The body matches the ScrapedResult shape — backend should accept
 * { emailId, profileId, queryId, shortCode, searchTerm, scrapedAt, products }.
 */
export async function postScrapedResult(result: ScrapedResult): Promise<void> {
  if (!config.resultsApiUrl) {
    console.warn(
      `[postScrapedResult] RESULTS_API_URL not set — logging payload instead. Query="${result.searchTerm}" products=${result.products.length}`,
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const res = await fetch(config.resultsApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}),
    },
    body: JSON.stringify(result),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`postScrapedResult ${res.status} ${res.statusText} ${text}`);
  }
}
