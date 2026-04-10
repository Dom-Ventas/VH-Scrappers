import { config } from '../config';
import { Query } from '../types';

/**
 * Fetch the list of search terms / ASINs to scrape from your backend, scoped
 * to a single profile. Each Query has { id, shortCode, searchTerm } where
 * `shortCode` is a marketplace short code (e.g. "AZIN") that the scrapper
 * resolves to an Amazon host via src/marketplaces.ts.
 */
export async function fetchQueries(profileId: string): Promise<Query[]> {
  if (!config.queriesApiUrl) {
    // Fallback sample queries so `npm run dev` is usable before the API is wired.
    console.warn(
      '[fetchQueries] QUERIES_API_URL is not set — returning sample queries. Set QUERIES_API_URL to call your real API.',
    );
    return [
      { id: 'sample-1', shortCode: 'AZIN', searchTerm: 'bluetooth headphones' },
      { id: 'sample-2', shortCode: 'AZIN', searchTerm: 'running shoes' },
    ];
  }

  const url = `${config.queriesApiUrl}?profile_id=${encodeURIComponent(profileId)}`;
  const res = await fetch(url, {
    headers: config.apiToken
      ? { Authorization: `Bearer ${config.apiToken}` }
      : undefined,
  });
  if (!res.ok) {
    throw new Error(`fetchQueries ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    items: Array<{ id: string; short_code: string; keyword: string }>;
  };
  return data.items.map((row) => ({
    id: row.id,
    shortCode: row.short_code,
    searchTerm: row.keyword,
  }));
}
