import { config } from '../config';
import { authFetch } from './auth';
import { Query } from '../types';

/** The backend refuses more than 50 `store_id`s in one request. */
const MAX_STORES_PER_REQUEST = 50;
/** Largest page the backend serves. */
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
 * the queue's pagination to the end:
 *
 *   GET {queriesApiUrl}?store_id=13&store_id=16&marketplace=flipkart&page=1&limit=100
 *   -> { items: [ { store_id, short_code, search_term } ], pagination: { page, limit, total, pages } }
 *
 * Each item carries its own store id and short code (e.g. "FKIN"), which the
 * scrapper resolves to a Flipkart host via src/marketplaces.ts. Store ids are
 * sent in chunks of 50, the most one request may carry.
 */
export async function fetchQueries(storeIds: number[]): Promise<Query[]> {
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
      for (const row of data.items ?? []) {
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
