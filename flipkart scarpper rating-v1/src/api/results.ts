import * as fs from 'fs';
import * as path from 'path';

import { config, localResultsDir } from '../config';
import { ScrapedResult } from '../types';
import { todayStamp } from '../util';
import { apiFetch } from './http';

/**
 * LOCAL mode (no RESULTS_API_URL): the exact body that would have been POSTed
 * is appended to results/store-<store_id>-<date>.jsonl instead — one JSON
 * object per line.
 *
 * Keeping the payload byte-identical to the API-mode body means a captured line
 * can be diffed against what the backend expects before the endpoint is wired
 * up, and switching modes needs no code change.
 */
function writeLocalResult(
  result: ScrapedResult
): void {

  const dir = localResultsDir();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(
    dir,
    `store-${result.store_id}-${todayStamp()}.jsonl`
  );

  fs.appendFileSync(
    filePath,
    JSON.stringify(result) + '\n',
    'utf8'
  );

  console.log(`[postScrapedResult] LOCAL -> ${filePath}`);
}

/**
 * POST one product page's result to /v1/scrapper/reviews:
 *   { store_id, product_ids, rating, rating_count, critical_reviews: { reviews },
 *     aplus_content, delivery_promise_days, pincode_applied }
 *
 * A 404 means a product id is not a focused listing of that store (or the store
 * is gone); it is thrown with the body text like any other non-2xx.
 */
export async function postScrapedResult(
  result: ScrapedResult
): Promise<void> {

  if (!config.resultsApiUrl) {
    writeLocalResult(result);
    return;
  }

  const res = await apiFetch(
    config.resultsApiUrl,
    {
      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body:
        JSON.stringify(result)
    }
  );

  if (!res.ok) {
    const body =
      await res.text();

    throw new Error(
      `postScrapedResult ${res.status} ${body}`
    );
  }
}
