import { config } from '../config';
import { authFetch } from './auth';
import { Query } from '../types';

/** The backend refuses more than this many `store_id`s in one request. */
const MAX_STORES_PER_REQUEST = 50;
const PAGE_LIMIT = 100;

interface QueueItem {
  store_id: number;
  short_code: string;
  search_term: string;
}

interface QueuePage {
  items: QueueItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Fetch every search term due today for the given VentaWiz stores, following
 * the paginated queue to the end. Each Query has { storeId, shortCode,
 * searchTerm } where `shortCode` is a marketplace short code (e.g. "NNAE")
 * that the scrapper resolves to a noon host + storefront via
 * src/marketplaces.ts.
 *
 *   GET {QUERIES_API_URL}?store_id=13&store_id=16&marketplace=noon&page=1&limit=100
 *   -> { items: [ { store_id, short_code, search_term } ], pagination: { page, limit, total, pages } }
 *
 * Store ids are sent in chunks of 50 (the backend's cap per request).
 */
export async function fetchQueries(storeIds: number[]): Promise<Query[]> {
  if (!config.queriesApiUrl) {
    // Fallback sample queries so `npm run dev` is usable before the API is wired.
    console.warn(
      '[fetchQueries] QUERIES_API_URL is not set — returning sample queries. Set QUERIES_API_URL to call your real API.',
    );
    const storeId = storeIds[0] ?? 0;
    return [
      { storeId, shortCode: 'NNAE', searchTerm: 'bluetooth headphones' },
      { storeId, shortCode: 'NNAE', searchTerm: 'protein powder' },
    ];
  }

  const queries: Query[] = [];
  for (let start = 0; start < storeIds.length; start += MAX_STORES_PER_REQUEST) {
    const chunk = storeIds.slice(start, start + MAX_STORES_PER_REQUEST);
    for (let page = 1; ; page++) {
      const params = new URLSearchParams();
      for (const id of chunk) params.append('store_id', String(id));
      params.set('marketplace', config.marketplace);
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));

      const res = await authFetch(`${config.queriesApiUrl}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`fetchQueries ${res.status} ${res.statusText} ${text}`);
      }
      const data = (await res.json()) as QueuePage;
      if (!Array.isArray(data?.items)) {
        throw new Error('fetchQueries: response has no items array');
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
