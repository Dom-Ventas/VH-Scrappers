// Values baked into official CI builds — see
// .github/workflows/build-windows-agent.yml.
//
// No secret lives here, ever: the exe ships WITHOUT credentials. Each laptop
// is given a VentaWiz service account (client id `svc_…` + client secret
// `vws_…`) at first run; it is saved in agent-config.json in the agent home.

// The VentaWiz server root (endpoints are `/v1/scrapper/...` under it, no
// `/api` prefix). Committed as a local dev server; the real VentaWiz host is
// baked in at build time from `VH_API_ROOT` (scripts/build-exe.js rewrites
// this line), or set at runtime with `VH_API_ROOT` in the .env.
export const EMBEDDED_API_ROOT = 'http://localhost:8000';

// The VentaWiz auth service root — the service-account token exchange is
// `POST /v1/token` under it. Committed as the local dev auth service; the real
// host is baked in at build time from `VW_AUTH_URL` (same mechanism as
// EMBEDDED_API_ROOT), or set at runtime with `VW_AUTH_URL` in the .env.
export const EMBEDDED_AUTH_ROOT = 'http://localhost:8100';

/**
 * Which marketplace this build of the agent is for: 'amazon' | 'flipkart' | 'noon'.
 *
 * One laptop runs one agent exe per marketplace, each with its own Chrome
 * profile — Chromium locks a persistent profile, so a single agent cannot hold
 * signed-in sessions for three sites at once — plus its own device id, lock
 * file and scheduled task. This constant is what separates them: it drives the
 * agent's home directory, its first-run sign-in domain, and the `agentKind` it
 * declares on check-in.
 *
 * Committed as 'amazon' so a plain `npm run build:exe` still produces exactly
 * the agent that exists today. The other two targets rewrite this line before
 * packaging, the same way CI rewrites EMBEDDED_API_ROOT — see the
 * `build:exe:flipkart` / `build:exe:noon` scripts in package.json.
 */
export const EMBEDDED_AGENT_KIND = 'amazon';
