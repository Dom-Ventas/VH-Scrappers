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
 *   GET  /v1/scrapper/search-term-queries?store_id=13&marketplace=walmart&page=1&limit=100
 *        -> { items: [ { store_id, short_code, search_term } ], pagination: { page, limit, total, pages } }
 *           (seeded from queries.json; terms already stored this session are left out)
 *   POST /v1/scrapper/search-term-results
 *        -> 201 { id, store_id, search_term, sponsored, organic, created_at }
 *           409 already stored this session · 422 { detail: [...] } contract violation
 *   GET  /v1/scrapper/search-term-results
 *        -> everything received this session, for inspection
 *   POST /v1/token
 *        -> 200 { access_token, token_type: "Bearer", expires_in } for any svc_/vws_ pair
 *           (a stand-in for DV-Auth's client_credentials exchange; point VW_AUTH_URL here)
 *   GET  /health
 *
 * The POST handler validates the result contract and rejects anything that
 * drifts from it, so a schema regression fails loudly here instead of
 * silently reaching production.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const PORT = Number(process.env.MOCK_PORT || 8789);
const BASE = '/v1/scrapper';
/** Lifetime the fake /v1/token reports, in seconds (DV-Auth uses 600). */
const TOKEN_TTL_S = Number(process.env.MOCK_TOKEN_TTL_S || 600);
let nextToken = 1;

const SEED_PATH = path.join(__dirname, 'queries.json');
const RECEIVED_DIR = path.join(__dirname, 'received');

type SeedRow = { store_id: number; short_code: string; search_term: string };
type Seed = SeedRow[];

const received: unknown[] = [];
/** `${store_id}|${lower-cased term}` already stored — the backend's 409 rule. */
const stored = new Set<string>();
let nextId = 1;

function storedKey(storeId: number, term: string): string {
  return `${storeId}|${term.toLowerCase()}`;
}

function loadSeed(): Seed {
  // Re-read per request so you can edit queries.json without restarting.
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8')) as Seed;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const RESULT_KEYS = ['store_id', 'search_term', 'products'] as const;

const PRODUCT_KEYS = [
  'position',
  'mp_product_id',
  'is_sponsored',
  'price',
  'rating',
  'review_count',
  'delivery_days',
  'title',
  'item_id',
] as const;

/**
 * Assert the posted body matches the VentaWiz search-term result contract.
 * Returns a list of human-readable problems (empty = valid).
 */
function validateResult(body: any): string[] {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) return ['body is not an object'];

  for (const key of RESULT_KEYS) {
    if (!(key in body)) errors.push(`missing top-level key "${key}"`);
  }
  for (const key of Object.keys(body)) {
    if (!(RESULT_KEYS as readonly string[]).includes(key)) {
      errors.push(`unexpected top-level key "${key}"`);
    }
  }

  if (!Number.isInteger(body.store_id)) errors.push('store_id is not an integer');
  if (typeof body.search_term !== 'string' || body.search_term.length === 0) {
    errors.push('search_term must be a non-empty string');
  }

  if (!Array.isArray(body.products)) {
    errors.push('products is not an array');
    return errors;
  }
  if (body.products.length > 60) {
    errors.push(`products has ${body.products.length} entries (backend schema caps at 60)`);
  }

  body.products.forEach((p: any, i: number) => {
    for (const key of PRODUCT_KEYS) {
      if (!(key in p)) errors.push(`products[${i}] missing "${key}"`);
    }
    for (const key of Object.keys(p)) {
      if (!(PRODUCT_KEYS as readonly string[]).includes(key)) {
        errors.push(`products[${i}] unexpected key "${key}"`);
      }
    }
    if (!Number.isInteger(p.position) || p.position < 1) {
      errors.push(`products[${i}].position is not an integer >= 1`);
    }
    if (typeof p.is_sponsored !== 'boolean') {
      errors.push(`products[${i}].is_sponsored is not a boolean`);
    }
    if (typeof p.mp_product_id !== 'string' || !p.mp_product_id) {
      errors.push(`products[${i}].mp_product_id must be a non-empty string`);
    }
    // Every remaining field is nullable by design (missing = null, never 0 or
    // -1), so only the type and range of a present value is checked.
    if (p.rating !== null && (typeof p.rating !== 'number' || p.rating < 0 || p.rating > 5)) {
      errors.push(`products[${i}].rating must be 0-5 or null`);
    }
    for (const key of ['review_count', 'delivery_days'] as const) {
      if (p[key] !== null && (!Number.isInteger(p[key]) || p[key] < 0)) {
        errors.push(`products[${i}].${key} must be an integer >= 0 or null`);
      }
    }
    for (const key of ['title', 'price'] as const) {
      if (p[key] !== null && typeof p[key] !== 'string') {
        errors.push(`products[${i}].${key} must be string|null`);
      }
    }
  });

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

  if (route === `GET ${BASE}/search-term-queries`) {
    const storeIds = url.searchParams.getAll('store_id').map(Number);
    if (storeIds.length === 0 || storeIds.length > 50 || storeIds.some((n) => !Number.isInteger(n))) {
      console.log('[MOCK] 422 GET search-term-queries — need 1-50 integer store_id');
      return send(res, 422, { detail: 'store_id: 1-50 integers required' });
    }
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const due = loadSeed().filter(
      (r) => storeIds.includes(r.store_id) && !stored.has(storedKey(r.store_id, r.search_term)),
    );
    const items = due.slice((page - 1) * limit, page * limit);
    const pages = Math.ceil(due.length / limit);
    console.log(
      `[MOCK] 200 GET search-term-queries store_id=[${storeIds.join(',')}] ` +
        `marketplace=${url.searchParams.get('marketplace')} page=${page}/${pages} -> ${items.length} items`,
    );
    return send(res, 200, { items, pagination: { page, limit, total: due.length, pages } });
  }

  if (route === `POST ${BASE}/search-term-results`) {
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      console.log('[MOCK] 422 POST search-term-results — body is not valid JSON');
      return send(res, 422, { detail: ['body is not valid JSON'] });
    }

    const errors = validateResult(body);
    if (errors.length > 0) {
      console.log(`[MOCK] 422 POST search-term-results — ${errors.length} contract violation(s):`);
      errors.forEach((e) => console.log(`         - ${e}`));
      return send(res, 422, { detail: errors });
    }

    const key = storedKey(body.store_id, body.search_term);
    if (stored.has(key)) {
      console.log(`[MOCK] 409 POST search-term-results ${body.store_id} "${body.search_term}" — already stored`);
      return send(res, 409, { detail: 'Already scraped today' });
    }
    stored.add(key);
    received.push(body);
    fs.mkdirSync(RECEIVED_DIR, { recursive: true });
    const slug = body.search_term.replace(/[^a-zA-Z0-9_-]+/g, '_');
    const file = path.join(RECEIVED_DIR, `${body.store_id}_${slug}.json`);
    fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf-8');

    const sponsored = Math.min(5, body.products.filter((p: any) => p.is_sponsored).length);
    const organic = Math.min(5, body.products.filter((p: any) => !p.is_sponsored).length);
    console.log(
      `[MOCK] 201 POST search-term-results ${body.store_id} "${body.search_term}" ` +
        `-> ${sponsored} sponsored, ${organic} organic saved to mock/received/${path.basename(file)}`,
    );
    return send(res, 201, {
      id: nextId++,
      store_id: body.store_id,
      search_term: body.search_term,
      sponsored,
      organic,
      created_at: new Date().toISOString(),
    });
  }

  if (route === `GET ${BASE}/search-term-results`) {
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
    // Surface EADDRINUSE to the caller instead of letting an unhandled 'error'
    // event crash the process with a raw stack trace.
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      console.log(`[MOCK] listening on http://127.0.0.1:${port}`);
      console.log(
        `[MOCK]   GET  http://127.0.0.1:${port}${BASE}/search-term-queries?store_id=13&marketplace=walmart`,
      );
      console.log(`[MOCK]   POST http://127.0.0.1:${port}${BASE}/search-term-results`);
      console.log('[MOCK]   token: POST /v1/token (any svc_/vws_ pair)');
      resolve(server);
    });
  });
}

// `npm run mock` executes this file directly; dev-api imports it instead.
if (require.main === module) {
  void startMockServer();
}
