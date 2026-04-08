import { config } from '../config';
import { Query } from '../types';

/**
 * Fetch the list of search terms / ASINs to scrape from your backend.
 *
 * TODO: Replace the body of this function with your real API call.
 * Expected: return Promise<Query[]> where each Query has { id, domain, searchTerm }.
 *
 * Example wiring (uncomment and adapt once you have the API spec):
 *
 *   const res = await fetch(config.queriesApiUrl, {
 *     headers: { Authorization: `Bearer ${config.apiToken}` },
 *   });
 *   if (!res.ok) throw new Error(`fetchQueries ${res.status}`);
 *   const data = await res.json() as { items: Array<{ id: string; marketplace: string; keyword: string }> };
 *   return data.items.map(row => ({
 *     id: row.id,
 *     domain: row.marketplace,
 *     searchTerm: row.keyword,
 *   }));
 */
export async function fetchQueries(): Promise<Query[]> {
  if (!config.queriesApiUrl) {
    // Fallback sample queries so `npm run dev` is usable before the API is wired.
    console.warn(
      '[fetchQueries] QUERIES_API_URL is not set — returning sample queries. Edit src/api/queries.ts to wire your real API.',
    );
    return [
      { id: 'sample-1', domain: config.defaultAmazonDomain, searchTerm: 'bluetooth headphones' },
      { id: 'sample-2', domain: config.defaultAmazonDomain, searchTerm: 'running shoes' },
    ];
  }

  throw new Error(
    'fetchQueries is not yet wired. Edit src/api/queries.ts and map your API response to Query[].',
  );
}
