import { config } from '../config';
import { ScrapedResult } from '../types';

/**
 * POST a single scraped result (one query + up to 10 products) to the ventahub backend.
 * Requires RESULTS_API_URL and API_TOKEN to be set in the .env file.
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
    const body = await res.text().catch(() => '');
    throw new Error(`postScrapedResult failed: HTTP ${res.status} ${res.statusText} — ${body}`);
  }
}
