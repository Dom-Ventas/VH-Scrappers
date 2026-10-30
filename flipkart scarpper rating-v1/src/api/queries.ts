import * as fs from 'fs';

import { config, localQueriesPath } from '../config';
import { Query } from '../types';
import { apiFetch } from './http';

/** The backend refuses more than 50 `store_id`s in one request. */
const MAX_STORES_PER_REQUEST = 50;

/** Largest page the backend serves. */
const PAGE_LIMIT = 100;

/**
 * One review-queue item:
 *   { product_ids: [101, 102], mp_product_id: "MOBHDDQKFPCHQV9B", short_code: "FKIN", store_id: 16 }
 */
function toQuery(
  row: any
): Query {

  return {
    productIds:
      Array.isArray(row.product_ids)
        ? row.product_ids.map(Number)
        : [],

    pid: String(row.mp_product_id ?? '').trim(),

    shortCode: String(
      row.short_code ?? 'FKIN'
    ).trim(),

    storeId: Number(row.store_id)
  };
}

/**
 * LOCAL mode (no QUERIES_API_URL): the work list is read from queries.json next
 * to the executable — a bare array of queue items in the API's own shape:
 *
 *   [ { "product_ids": [101], "mp_product_id": "ACC...", "short_code": "FKIN", "store_id": 13 } ]
 *
 * Only items for the given store ids are returned, as the API would.
 */
function loadLocalQueries(
  storeIds: number[]
): Query[] {

  const filePath = localQueriesPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `No API configured and no local query file at ${filePath}. ` +
        'Create it, or set QUERIES_API_URL in .env'
    );
  }

  let parsed: any;

  try {

    parsed = JSON.parse(
      fs.readFileSync(filePath, 'utf8')
    );

  } catch (err) {

    throw new Error(
      `Could not parse ${filePath}: ${err}`
    );
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed?.items;

  if (!Array.isArray(rows)) {
    throw new Error(
      `${filePath} must be an array of queue items (or { "items": [...] })`
    );
  }

  console.log(
    `[fetchQueries] LOCAL ${filePath} -> storeIds=[${storeIds.join(', ')}]`
  );

  return rows
    .map(toQuery)
    .filter(q => q.pid && storeIds.includes(q.storeId));
}

/**
 * Fetch every product page due for the given VentaWiz stores, following the
 * queue's pagination to the end:
 *
 *   GET {queriesApiUrl}?store_id=13&store_id=16&marketplace=flipkart&page=1&limit=100
 *   -> { items: [...], pagination: { page, limit, total, pages } }
 *
 * Store ids are sent in chunks of 50, the most one request may carry.
 */
export async function fetchQueries(
  storeIds: number[]
): Promise<Query[]> {

  if (!config.queriesApiUrl) {
    return loadLocalQueries(storeIds);
  }

  const queries: Query[] = [];

  for (
    let start = 0;
    start < storeIds.length;
    start += MAX_STORES_PER_REQUEST
  ) {

    const chunk =
      storeIds.slice(start, start + MAX_STORES_PER_REQUEST);

    for (let page = 1; ; page++) {

      const params = new URLSearchParams();

      for (const id of chunk) {
        params.append('store_id', String(id));
      }

      params.set('marketplace', config.marketplace);
      params.set('page', String(page));
      params.set('limit', String(PAGE_LIMIT));

      const url =
        `${config.queriesApiUrl}?${params.toString()}`;

      console.log(
        '[fetchQueries] URL:',
        url
      );

      const res = await apiFetch(url);

      if (!res.ok) {

        const body =
          await res.text();

        throw new Error(
          `fetchQueries ${res.status} ${body}`
        );
      }

      const data =
        await res.json();

      if (
        !data.items ||
        !Array.isArray(data.items)
      ) {

        throw new Error(
          'Invalid query response'
        );
      }

      queries.push(
        ...data.items
          .map(toQuery)
          .filter((q: Query) => q.pid)
      );

      const pages =
        Number(data.pagination?.pages) || 0;

      if (pages === 0 || page >= pages) {
        break;
      }
    }
  }

  return queries;
}
