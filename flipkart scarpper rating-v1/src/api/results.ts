import * as fs from 'fs';
import * as path from 'path';

import { config, localResultsDir } from '../config';
import { ScrapedResult } from '../types';
import { todayStamp } from '../util';
import { apiFetch, authHeaders } from './http';

/**
 * Backend integration is pending, so with no RESULTS_API_URL configured the
 * exact body that would have been POSTed is appended to
 * results/<profileId>-<date>.jsonl instead — one JSON object per line.
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

  const safeProfileId =
    result.profileId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';

  const filePath = path.join(
    dir,
    `${safeProfileId}-${todayStamp()}.jsonl`
  );

  fs.appendFileSync(
    filePath,
    JSON.stringify(result) + '\n',
    'utf8'
  );

  console.log(`[postScrapedResult] LOCAL -> ${filePath}`);
}

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

      headers: authHeaders(),

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
