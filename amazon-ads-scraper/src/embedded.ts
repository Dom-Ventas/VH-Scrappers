// Values baked into official CI builds — see
// .github/workflows/build-windows-agent.yml.
//
// This file is committed with an EMPTY token on purpose. The build workflow
// overwrites EMBEDDED_TOKEN from the `SCRAPPER_API_TOKEN` repo secret right
// before packaging, so released exes are self-contained (no .env needed on
// laptops) while the token never lives in source.
//
// EMBEDDED_API_ROOT is NOT injected — it is committed, so changing the backend
// host is a code change and a merge, not a workflow input.
//
// Note the precedence: when the VentaHub agent launches this scraper it sets
// QUERIES_API_URL / RESULTS_API_URL / API_TOKEN from the backend's assignment,
// and those always win. The values here are the fallback for a standalone run.
export const EMBEDDED_TOKEN = '';
export const EMBEDDED_API_ROOT = 'https://domventas.info/backend';

/** Default endpoints for the Amazon ads scraper, relative to the API root. */
export const QUERY_ENDPOINT = '/api/v1/scrapper/queries';
export const RESULTS_ENDPOINT = '/api/v1/scrapper/results';
