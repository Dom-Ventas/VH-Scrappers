import { config } from '../config';
import { ScrapedResult } from '../types';

export async function postScrapedResult(
  result: ScrapedResult
): Promise<void> {

  const res = await fetch(
    config.resultsApiUrl,
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${config.apiToken}`,

        'Content-Type':
          'application/json'
      },

      body: JSON.stringify(result)
    }
  );

  if (!res.ok) {
    const body = await res.text();

    throw new Error(
      `postScrapedResult ${res.status} ${body}`
    );
  }
}
