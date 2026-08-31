import * as fs from 'fs';

import { config, localQueriesPath } from '../config';
import { Query } from '../types';
import { apiFetch, authHeaders } from './http';

function toQuery(
  row: any
): Query {

  return {
    productId: row.productId ?? row.product_id,

    // Accepts `pid` or `asin` so the same mapper works whichever field name the
    // backend settles on (see PLAN.md §11.1).
    pid: String(row.pid ?? row.asin ?? '').trim(),

    shortCode: String(
      row.shortCode ?? row.short_code ?? 'FKIN'
    ).trim()
  };
}

/**
 * Backend integration is pending, so with no QUERIES_API_URL configured the
 * scraper reads its work list from queries.json next to the executable:
 *
 *   { "default": [ { "productId": 1, "pid": "ACC...", "shortCode": "FKIN" } ] }
 *
 * Keyed by profileId so this exercises the same per-profile loop the live API
 * will drive. A bare array is also accepted and treated as one profile.
 */
function loadLocalQueries(
  profileId: string
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
    : parsed?.[profileId] ?? parsed?.default;

  if (!Array.isArray(rows)) {
    throw new Error(
      `No entry for profileId="${profileId}" in ${filePath}`
    );
  }

  console.log(
    `[fetchQueries] LOCAL ${filePath} -> profileId="${profileId}"`
  );

  return rows.map(toQuery).filter(q => q.pid);
}

export async function fetchQueries(
  profileId: string
): Promise<Query[]> {

  if (!config.queriesApiUrl) {
    return loadLocalQueries(profileId);
  }

  const url =
    `${config.queriesApiUrl}?profile_id=${encodeURIComponent(profileId)}`;

  console.log(
    '[fetchQueries] URL:',
    url
  );

  const res = await apiFetch(
    url,
    {
      headers: authHeaders()
    }
  );

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

  return data.items.map(toQuery);
}
