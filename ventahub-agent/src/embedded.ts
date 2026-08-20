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
