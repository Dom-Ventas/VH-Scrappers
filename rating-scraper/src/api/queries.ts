import { config } from '../config';
import { authFetch } from './auth';
import { Query } from '../types';

/** The backend refuses more than 50 store ids in one request. */
const MAX_STORES_PER_REQUEST = 50;

/** The backend's page size cap. */
const PAGE_LIMIT = 100;

interface QueuePage {
  items: Array<{
    product_ids: number[];
    mp_product_id: string;
    short_code: string;
    store_id: number;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/**
 * Fetch the whole review queue for the given VentaWiz stores, once, up front.
 * GET `${queriesApiUrl}?store_id=..&store_id=..&marketplace=amazon&page=N&limit=100`,
 * chunked to 50 stores per request and paged until `pagination.pages`.
 *
 * One item per product page per store; `product_ids` lists every listing the
 * page answers for. Listings rated in the last 24h are left out by the backend.
 */
export async function fetchQueries(
  storeIds: number[]
): Promise<Query[]> {

  const queries: Query[] = [];

  for (
    let c = 0;
    c < storeIds.length;
    c += MAX_STORES_PER_REQUEST
  ) {

    const chunk =
      storeIds.slice(c, c + MAX_STORES_PER_REQUEST);

    for (let page = 1; ; page++) {

      const params = new URLSearchParams();
      for (const id of chunk) params.append('store_id', String(id));
      params.set('marketplace', config.marketplace);
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));

      const url =
        `${config.queriesApiUrl}?${params.toString()}`;

      console.log(
        '[fetchQueries] URL:',
        url
      );

      const res = await authFetch(url);

      if (!res.ok) {

        const body =
          await res.text().catch(() => '');

        throw new Error(
          `fetchQueries ${res.status} ${body}`
        );
      }

      const data =
        (await res.json()) as QueuePage;

      if (
        !data ||
        !Array.isArray(data.items)
      ) {

        throw new Error(
          'Invalid query response'
        );
      }

      for (const row of data.items) {
        queries.push({
          productIds: row.product_ids,
          asin: row.mp_product_id,
          shortCode: row.short_code,
          storeId: row.store_id
        });
      }

      const pages =
        data.pagination?.pages ?? 0;

      if (pages === 0 || page >= pages) {
        break;
      }
    }
  }

  return queries;
}
