/**
 * Mock backend for local development — stands in for the VentaWiz scrapper API
 * so the whole loop (fetch queue -> scrape -> post results) can be exercised
 * end to end with no network dependency.
 *
 *   npm run mock          # terminal 1
 *   npm run dev           # terminal 2 (point QUERIES_API_URL / RESULTS_API_URL here)
 *
 * Routes mirror the VentaWiz paths, so pointing at the real backend is a host
 * swap in .env and nothing more:
 *
 *   GET  /v1/scrapper/review-queries?store_id=13&marketplace=ebay&page=1&limit=100
 *        -> { items: [ { product_ids, mp_product_id, short_code, store_id } ], pagination }
 *           (seeded from queries.json; products stored this session are left out)
 *   POST /v1/scrapper/reviews
 *        -> 200 [ { product_id, store_id, rating, rating_count, has_aplus_content,
 *                   delivery_promise_days, updated_at } ]
 *           404 unknown product id · 422 { detail: [...] } contract violation
 *   GET  /v1/scrapper/reviews
 *        -> everything received this session, for inspection
 *   POST /v1/token
 *        -> 200 { access_token, token_type: "Bearer", expires_in } for any svc_/vws_ pair
 *           (a stand-in for DV-Auth's client_credentials exchange; point VW_AUTH_URL here)
 *   GET  /health
 *
 * The POST handler validates the result contract and rejects anything that
 * drifts from it, so a schema regression fails loudly here instead of
 * silently reaching production. Unknown top-level fields are allowed, as
 * VentaWiz allows them on this endpoint (each scraper sends its own extras).
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// 8791: the ads mocks use 8789, so both can run side by side.
const PORT = Number(process.env.MOCK_PORT || 8791);
const BASE = '/v1/scrapper';
/** Lifetime the fake /v1/token reports, in seconds (DV-Auth uses 600). */
const TOKEN_TTL_S = Number(process.env.MOCK_TOKEN_TTL_S || 600);
let nextToken = 1;

const SEED_PATH = path.join(__dirname, 'queries.json');
const RECEIVED_DIR = path.join(__dirname, 'received');

type SeedRow = { store_id: number; short_code: string; mp_product_id: string; product_ids: number[] };

const received: unknown[] = [];
/** product ids already rated this session — the backend's "not due for 24h" rule. */
const rated = new Set<string>();

function loadSeed(): SeedRow[] {
  // Re-read per request so you can edit queries.json without restarting.
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8')) as SeedRow[];
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Assert the posted body matches the VentaWiz review result contract.
 * Returns a list of human-readable problems (empty = valid).
 */
function validateResult(body: any): string[] {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) return ['body is not an object'];

  if (!Number.isInteger(body.store_id)) errors.push('store_id is not an integer');
  if (!Array.isArray(body.product_ids) || body.product_ids.length < 1 || body.product_ids.length > 100) {
    errors.push('product_ids must be a list of 1-100 integers');
  } else if (body.product_ids.some((n: unknown) => !Number.isInteger(n))) {
    errors.push('product_ids must all be integers');
  }
  if (body.rating !== null && body.rating !== undefined) {
    if (typeof body.rating !== 'number' || body.rating < 0 || body.rating > 5) errors.push('rating must be 0-5 or null');
    else if (Number(body.rating.toFixed(2)) !== body.rating) errors.push('rating has more than 2 decimals');
  }
  for (const key of ['rating_count', 'delivery_promise_days'] as const) {
    if (body[key] !== null && body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 0)) {
      errors.push(`${key} must be an integer >= 0 or null`);
    }
  }
  if (body.critical_reviews !== null && body.critical_reviews !== undefined) {
    if (typeof body.critical_reviews !== 'object' || !Array.isArray(body.critical_reviews.reviews)) {
      errors.push('critical_reviews must be { reviews: [...] } or null');
    } else {
      body.critical_reviews.reviews.forEach((r: any, i: number) => {
        if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) errors.push(`reviews[${i}].rating must be 1-5`);
      });
    }
  }
  if (body.aplus_content !== null && body.aplus_content !== undefined && !['yes', 'no'].includes(body.aplus_content)) {
    errors.push('aplus_content must be "yes", "no" or null');
  }
  return errors;
}

function authorized(req: http.IncomingMessage): boolean {
  // The mock does not verify tokens; it only checks one was sent.
  return /^Bearer \S+/.test(req.headers.authorization || '');
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

/** Results accepted this session — read by scripts/dev-api.ts for its summary. */
export function getReceived(): unknown[] {
  return received;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /health') {
    return send(res, 200, { ok: true, received: received.length });
  }

  if (route === 'POST /v1/token') {
    let body: any = null;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      /* treated as bad credentials below */
    }
    const ok =
      body?.grant_type === 'client_credentials' &&
      typeof body.client_id === 'string' &&
      body.client_id.startsWith('svc_') &&
      typeof body.client_secret === 'string' &&
      body.client_secret.startsWith('vws_');
    if (!ok) {
      console.log('[MOCK] 401 POST /v1/token — invalid_client');
      return send(res, 401, { error: 'invalid_client' });
    }
    console.log(`[MOCK] 200 POST /v1/token client_id=${body.client_id}`);
    return send(res, 200, {
      access_token: `mock-token-${nextToken++}`,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_S,
    });
  }

  if (!authorized(req)) {
    console.log(`[MOCK] 401 ${route} — bad or missing bearer token`);
    return send(res, 401, { ok: false, error: 'unauthorized' });
  }

  if (route === `GET ${BASE}/review-queries`) {
    const storeIds = url.searchParams.getAll('store_id').map(Number);
    if (storeIds.length === 0 || storeIds.length > 50 || storeIds.some((n) => !Number.isInteger(n))) {
      console.log('[MOCK] 422 GET review-queries — need 1-50 integer store_id');
      return send(res, 422, { detail: 'store_id: 1-50 integers required' });
    }
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const due = loadSeed().filter(
      (r) => storeIds.includes(r.store_id) && !r.product_ids.every((id) => rated.has(`${r.store_id}|${id}`)),
    );
    const items = due.slice((page - 1) * limit, page * limit);
    const pages = Math.ceil(due.length / limit);
    console.log(
      `[MOCK] 200 GET review-queries store_id=[${storeIds.join(',')}] ` +
        `marketplace=${url.searchParams.get('marketplace')} page=${page}/${pages} -> ${items.length} items`,
    );
    return send(res, 200, { items, pagination: { page, limit, total: due.length, pages } });
  }

  if (route === `POST ${BASE}/reviews`) {
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      console.log('[MOCK] 422 POST reviews — body is not valid JSON');
      return send(res, 422, { detail: ['body is not valid JSON'] });
    }

    const errors = validateResult(body);
    if (errors.length > 0) {
      console.log(`[MOCK] 422 POST reviews — ${errors.length} contract violation(s):`);
      errors.forEach((e) => console.log(`         - ${e}`));
      return send(res, 422, { detail: errors });
    }

    // "All or nothing": every product id must be a focused listing of the store.
    const known = new Set(
      loadSeed()
        .filter((r) => r.store_id === body.store_id)
        .flatMap((r) => r.product_ids),
    );
    const unknown = body.product_ids.filter((id: number) => !known.has(id));
    if (unknown.length > 0) {
      console.log(`[MOCK] 404 POST reviews — not focused listings of store ${body.store_id}: [${unknown.join(', ')}]`);
      return send(res, 404, { detail: `Not focused listings of store ${body.store_id}: [${unknown.join(', ')}]` });
    }

    received.push(body);
    fs.mkdirSync(RECEIVED_DIR, { recursive: true });
    const row = loadSeed().find((r) => r.store_id === body.store_id && r.product_ids.some((id) => body.product_ids.includes(id)));
    const file = path.join(RECEIVED_DIR, `${body.store_id}_${row?.mp_product_id || body.product_ids[0]}.json`);
    fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf-8');
    for (const id of body.product_ids) rated.add(`${body.store_id}|${id}`);

    const n = body.critical_reviews?.reviews?.length ?? 0;
    console.log(
      `[MOCK] 200 POST reviews store ${body.store_id} product_ids=[${body.product_ids.join(', ')}] ` +
        `-> rating ${body.rating} (${body.rating_count}), ${n} critical reviews, delivery ${body.delivery_promise_days} ` +
        `saved to mock/received/${path.basename(file)}`,
    );
    const now = new Date().toISOString();
    return send(
      res,
      200,
      body.product_ids.map((id: number) => ({
        product_id: id,
        store_id: body.store_id,
        rating: body.rating,
        rating_count: body.rating_count,
        has_aplus_content: body.aplus_content === null || body.aplus_content === undefined ? null : body.aplus_content === 'yes',
        delivery_promise_days: body.delivery_promise_days,
        updated_at: now,
      })),
    );
  }

  if (route === `GET ${BASE}/reviews`) {
    return send(res, 200, { count: received.length, items: received });
  }

  console.log(`[MOCK] 404 ${route}`);
  return send(res, 404, { ok: false, error: 'not found' });
});

/**
 * Start listening. Exported so `npm run dev-api` can host the mock in the same
 * process as its scraper run instead of shelling out a second terminal.
 */
export function startMockServer(port: number = PORT): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      console.log(`[MOCK] listening on http://127.0.0.1:${port}`);
      console.log(`[MOCK]   GET  http://127.0.0.1:${port}${BASE}/review-queries?store_id=13&marketplace=ebay`);
      console.log(`[MOCK]   POST http://127.0.0.1:${port}${BASE}/reviews`);
      console.log('[MOCK]   token: POST /v1/token (any svc_/vws_ pair)');
      resolve(server);
    });
  });
}

// `npm run mock` executes this file directly; dev-api imports it instead.
if (require.main === module) {
  void startMockServer();
}
