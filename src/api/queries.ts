import { config } from '../config';
import { Query } from '../types';

/**
 * Fetch the list of search-term queries to scrape from the ventahub backend.
 * Requires QUERIES_API_URL and API_TOKEN to be set in the .env file.
 */
export async function fetchQueries(profileId: string): Promise<Query[]> {
  if (!config.queriesApiUrl) {
    throw new Error(
      'QUERIES_API_URL is not set. Add it to your .env file.',
    );
  }

  const url = `${config.queriesApiUrl}?profile_id=${encodeURIComponent(profileId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.apiToken}` },
  });

  if (!res.ok) {
    throw new Error(`fetchQueries failed: HTTP ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    items: Array<{ id: string; short_code: string; keyword: string }>;
  };

  return data.items.map(row => ({
    id: row.id,
    shortCode: row.short_code,
    searchTerm: row.keyword,
  }));
}
