import { config } from '../config';
import { authFetch } from './auth';
import { Query } from '../types';

/** The backend refuses more than this many `store_id`s in one request. */
const MAX_STORES_PER_REQUEST = 50;
const PAGE_LIMIT = 100;

interface QueueItem {
  product_ids: number[];
  mp_product_id: string;
  short_code: string;
  store_id: number;
}

interface QueuePage {
  items: QueueItem[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Fetch every product page due for the given VentaWiz stores, following the
 * paginated queue to the end:
 *
 *   GET {QUERIES_API_URL}?store_id=13&store_id=16&marketplace=walmart&page=1&limit=100
 *   -> { items: [ { product_ids, mp_product_id, short_code, store_id } ],
 *        pagination: { page, limit, total, pages } }
 *
 * `mp_product_id` is Walmart's wpid. Store ids are sent in chunks of 50 (the
 * backend's cap per request).
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
      if (!Array.isArray(data?.items)) {
        throw new Error('fetchQueries: response has no items array');
      }
      for (const row of data.items) {
        queries.push({
          productIds: row.product_ids,
          wpid: row.mp_product_id,
          shortCode: row.short_code,
          storeId: row.store_id,
        });
      }
      const pages = data.pagination?.pages ?? 0;
      if (pages === 0 || page >= pages) break;
    }
  }
  return queries;
}
