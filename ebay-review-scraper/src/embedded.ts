// Values baked into official CI builds — see
// .github/workflows/build-windows-agent.yml.
//
// No secret lives here, ever: the exe ships WITHOUT credentials. It
// authenticates with a VentaWiz service account (VW_CLIENT_ID /
// VW_CLIENT_SECRET), which the VentaWiz agent passes in when it launches this
// scraper, or which a standalone run reads from its .env.
//
// EMBEDDED_API_ROOT is the VentaWiz server root (no `/api` prefix — every
// endpoint already starts with `/v1/scrapper/...`). EMBEDDED_AUTH_ROOT is the
// VentaWiz auth service root (the token exchange is `/v1/token` under it).
// The committed values are local dev servers; the real hosts are baked in at
// build time from `VH_API_ROOT` / `VW_AUTH_URL` (scripts/build-exe.js and CI
// patch these lines), or set at runtime with the same env vars.
//
// Note the precedence: when the VentaWiz agent launches this scraper it sets
// QUERIES_API_URL / RESULTS_API_URL / VW_AUTH_URL from its own config, and
// those always win. The values here are the fallback for a standalone run.
export const EMBEDDED_API_ROOT = 'http://localhost:8000';
export const EMBEDDED_AUTH_ROOT = 'http://localhost:8100';

/**
 * Default endpoints for the eBay review scraper, relative to the API root.
 *
 * One API serves every marketplace — VentaWiz tells the scrapers apart by the
 * `marketplace=` query parameter and each store's `short_code`, not by the
 * path. These are the same two paths every reviews entry in the backend's
 * catalog hands the agent (`ventawiz/scrapper/catalog.py`, `_ENDPOINTS[REVIEWS]`).
 */
export const QUERY_ENDPOINT = '/v1/scrapper/review-queries';
export const RESULTS_ENDPOINT = '/v1/scrapper/reviews';
