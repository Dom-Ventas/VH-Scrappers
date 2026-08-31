/**
 * Mock backend for local development — stands in for the real scrapper API so
 * the whole loop (fetch queries -> scrape -> post results) can be exercised
 * end to end with no network dependency.
 *
 *   npm run mock          # terminal 1
 *   npm run dev           # terminal 2 (uses the URLs in .env)
 *
 * Routes mirror the production path shape, so pointing at the real backend is
 * a host swap in .env and nothing more:
 *
 *   GET  /backend/api/v1/scrapper/queries?profile_id=PRF-001
 *        -> { items: [ { id, short_code, keyword } ] }   (seeded from queries.json)
 *   POST /backend/api/v1/scrapper/results
 *        -> 200 { ok: true }  or  400 { ok: false, errors: [...] }
 *   GET  /backend/api/v1/scrapper/results
 *        -> everything received this session, for inspection
 *   GET  /health
 *
 * The POST handler validates the ScrapedResult contract and rejects anything
 * that drifts from it, so a schema regression fails loudly here instead of
 * silently reaching production.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const PORT = Number(process.env.MOCK_PORT || 8787);
const BASE = '/backend/api/v1/scrapper';
/** Set to a non-empty string to require `Authorization: Bearer <token>`. */
const EXPECTED_TOKEN = process.env.MOCK_API_TOKEN || 'dummy-local-token';

const SEED_PATH = path.join(__dirname, 'queries.json');
const RECEIVED_DIR = path.join(__dirname, 'received');

type SeedRow = { id: string; short_code: string; keyword: string };
type Seed = Record<string, SeedRow[]>;

const received: unknown[] = [];

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

const RESULT_KEYS = [
  'emailId',
  'profileId',
  'queryId',
  'shortCode',
  'searchTerm',
  'scrapedAt',
  'products',
] as const;

const PRODUCT_KEYS = [
  'position',
  'asin',
  'isSponsored',
  'title',
  'price',
  'rating',
  'reviewCount',
  'deliveryText',
  'deliveryDays',
] as const;

/**
 * Assert the posted body matches the ScrapedResult contract shared with the
 * Amazon scrapper. Returns a list of human-readable problems (empty = valid).
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

  if (typeof body.scrapedAt === 'string' && Number.isNaN(Date.parse(body.scrapedAt))) {
    errors.push(`scrapedAt "${body.scrapedAt}" is not a valid ISO timestamp`);
  }

  if (!Array.isArray(body.products)) {
    errors.push('products is not an array');
    return errors;
  }
  if (body.products.length > 10) {
    errors.push(`products has ${body.products.length} entries (backend schema caps at 10)`);
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
    if (typeof p.position !== 'number') errors.push(`products[${i}].position is not a number`);
    if (typeof p.isSponsored !== 'boolean') {
      errors.push(`products[${i}].isSponsored is not a boolean`);
    }
    // Every remaining field is nullable by design, so only the type of a
    // present value is checked.
    if (p.rating !== null && typeof p.rating !== 'number') {
      errors.push(`products[${i}].rating must be number|null`);
    }
    if (p.reviewCount !== null && typeof p.reviewCount !== 'number') {
      errors.push(`products[${i}].reviewCount must be number|null`);
    }
    if (p.deliveryDays !== null && typeof p.deliveryDays !== 'number') {
      errors.push(`products[${i}].deliveryDays must be number|null`);
    }
    for (const key of ['asin', 'title', 'price', 'deliveryText'] as const) {
      if (p[key] !== null && typeof p[key] !== 'string') {
        errors.push(`products[${i}].${key} must be string|null`);
      }
    }
  });

  return errors;
}

function authorized(req: http.IncomingMessage): boolean {
  if (!EXPECTED_TOKEN) return true;
  return (req.headers.authorization || '') === `Bearer ${EXPECTED_TOKEN}`;
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

  if (!authorized(req)) {
    console.log(`[MOCK] 401 ${route} — bad or missing bearer token`);
    return send(res, 401, { ok: false, error: 'unauthorized' });
  }

  if (route === `GET ${BASE}/queries`) {
    const profileId = url.searchParams.get('profile_id') || '';
    const items = loadSeed()[profileId] || [];
    console.log(`[MOCK] 200 GET queries profile_id="${profileId}" -> ${items.length} items`);
    return send(res, 200, { items });
  }

  if (route === `POST ${BASE}/results`) {
    let body: any;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      console.log('[MOCK] 400 POST results — body is not valid JSON');
      return send(res, 400, { ok: false, errors: ['body is not valid JSON'] });
    }

    const errors = validateResult(body);
    if (errors.length > 0) {
      console.log(`[MOCK] 400 POST results — ${errors.length} contract violation(s):`);
      errors.forEach((e) => console.log(`         - ${e}`));
      return send(res, 400, { ok: false, errors });
    }

    received.push(body);
    fs.mkdirSync(RECEIVED_DIR, { recursive: true });
    const file = path.join(RECEIVED_DIR, `${body.profileId}_${body.queryId}.json`);
    fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf-8');

    const sponsored = body.products.filter((p: any) => p.isSponsored).length;
    console.log(
      `[MOCK] 200 POST results ${body.profileId}/${body.queryId} "${body.searchTerm}" ` +
        `-> ${body.products.length} products (${sponsored} sponsored, ` +
        `${body.products.length - sponsored} organic) saved to mock/received/${path.basename(file)}`,
    );
    return send(res, 200, { ok: true, stored: body.products.length });
  }

  if (route === `GET ${BASE}/results`) {
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
      console.log(`[MOCK]   GET  http://127.0.0.1:${port}${BASE}/queries?profile_id=PRF-001`);
      console.log(`[MOCK]   POST http://127.0.0.1:${port}${BASE}/results`);
      console.log(`[MOCK]   bearer token: ${EXPECTED_TOKEN || '(auth disabled)'}`);
      resolve(server);
    });
  });
}

// `npm run mock` executes this file directly; dev-api imports it instead.
if (require.main === module) {
  void startMockServer();
}
