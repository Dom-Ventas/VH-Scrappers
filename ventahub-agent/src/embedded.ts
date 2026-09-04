// Values baked into official CI builds — see
// .github/workflows/build-windows-agent.yml.
//
// This file is committed with an EMPTY token on purpose. The build workflow
// overwrites EMBEDDED_TOKEN from the `SCRAPPER_API_TOKEN` repo secret right
// before packaging, so the released exe is self-contained (no .env needed on
// laptops) while the token never lives in source.
//
// For LOCAL builds this stays empty — provide API_TOKEN via a .env instead.
export const EMBEDDED_TOKEN = '';
export const EMBEDDED_API_ROOT = 'https://domventas.info/backend';

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
 * packaging, the same way CI rewrites EMBEDDED_TOKEN — see the
 * `build:exe:flipkart` / `build:exe:noon` scripts in package.json.
 */
export const EMBEDDED_AGENT_KIND = 'amazon';
