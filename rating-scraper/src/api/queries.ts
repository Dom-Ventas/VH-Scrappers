import { config } from '../config';
import { Query } from '../types';

export async function fetchQueries(
  profileId: string
): Promise<Query[]> {

  const url =
    `${config.queriesApiUrl}?profile_id=${encodeURIComponent(profileId)}`;

  console.log(
    '[fetchQueries] URL:',
    url
  );

  const res = await fetch(
    url,
    {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      }
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
console.log("========== API RESPONSE ==========");
console.log(JSON.stringify(data, null, 2));
  return data.items.map(
    (row: any): Query => ({
      productId: row.productId,
      asin: row.asin,
      shortCode: row.shortCode
    })
  );
}