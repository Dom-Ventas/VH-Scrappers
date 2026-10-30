import { config } from '../config';
import { authFetch } from './auth';
import { Query } from '../types';

/** The backend refuses more than 50 store ids in one request. */
const MAX_STORES_PER_REQUEST = 50;
/** The backend's page size cap. */
const PAGE_LIMIT = 100;

interface QueuePage {
  items: Array<{ store_id: number; short_code: string; search_term: string }>;
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Fetch the whole search-term queue for the given VentaWiz stores, once, up
 * front. GET `${queriesApiUrl}?store_id=..&store_id=..&marketplace=amazon&page=N&limit=100`,
 * chunked to 50 stores per request and paged until `pagination.pages`.
 *
 * Each Query carries its own storeId and shortCode (e.g. "AZAE"), which the
 * scraper resolves to an Amazon host via src/marketplaces.ts. Terms already
 * scraped today are left out by the backend.
 */
export async function fetchQueries(storeIds: number[]): Promise<Query[]> {
  const queries: Query[] = [];
  for (let c = 0; c < storeIds.length; c += MAX_STORES_PER_REQUEST) {
    const chunk = storeIds.slice(c, c + MAX_STORES_PER_REQUEST);
    for (let page = 1; ; page++) {
      const params = new URLSearchParams();
      for (const id of chunk) params.append('store_id', String(id));
      params.set('marketplace', config.marketplace);
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));
      const url = `${config.queriesApiUrl}?${params.toString()}`;

      const res = await authFetch(url);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`fetchQueries ${res.status} ${res.statusText} ${text}`);
      }
      const data = (await res.json()) as QueuePage;
      if (!data || !Array.isArray(data.items)) {
        throw new Error('fetchQueries: invalid queue response (no items array)');
      }
      for (const row of data.items) {
        queries.push({
          storeId: row.store_id,
          shortCode: row.short_code,
          searchTerm: row.search_term,
        });
      }
      const pages = data.pagination?.pages ?? 0;
      if (pages === 0 || page >= pages) break;
    }
  }
  return queries;
}
