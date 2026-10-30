#!/usr/bin/env node
/**
 * Builds the agent exes with the VentaWiz API root and auth root BAKED IN.
 *
 * Local-build equivalent of .github/workflows/build-windows-agent.yml: it
 * patches src/embedded.ts just before packaging, and the file is ALWAYS
 * restored afterwards so the committed localhost defaults stay in source.
 *
 * No secret is baked in: every laptop enters its own VentaWiz service account
 * (client id + secret) on first run.
 *
 * Usage:  node scripts/build-exe.js [amazon|flipkart|noon ...]   (default: all three)
 * Values come from .env (or real env vars, which win):
 *   VH_API_ROOT  - the VentaWiz server root (no /api suffix — endpoints are
 *                  /v1/scrapper/...). Optional, but the committed value in
 *                  embedded.ts is http://localhost:8000, so set it for any exe
 *                  that leaves this machine.
 *   VW_AUTH_URL  - the VentaWiz auth service root (token exchange is
 *                  /v1/token under it). Optional, but the committed value is
 *                  http://localhost:8100 — set it for any exe that leaves this
 *                  machine.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config();

const ROOT = path.join(__dirname, '..');
const EMBEDDED = path.join(ROOT, 'src', 'embedded.ts');
const original = fs.readFileSync(EMBEDDED, 'utf-8');

const OUTPUTS = {
  amazon: 'dist/VentaHubAgent.exe',
  flipkart: 'dist/VentaHubAgentFlipkart.exe',
  noon: 'dist/VentaHubAgentNoon.exe',
};

const kinds = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(OUTPUTS);
for (const kind of kinds) {
  if (!OUTPUTS[kind]) {
    console.error(`[bake] unknown kind "${kind}" — expected ${Object.keys(OUTPUTS).join(' | ')}`);
    process.exit(1);
  }
}

const apiRoot = (process.env.VH_API_ROOT || '').trim().replace(/\/+$/, '');
const authRoot = (process.env.VW_AUTH_URL || '').trim().replace(/\/+$/, '');

console.log(`[bake] VH_API_ROOT : ${apiRoot || '(keeping committed value)'}`);
console.log(`[bake] VW_AUTH_URL : ${authRoot || '(keeping committed value)'}`);
if (!apiRoot) {
  console.warn('[bake] WARNING: no VH_API_ROOT — the exe will call the committed root (http://localhost:8000).');
}
if (!authRoot) {
  console.warn('[bake] WARNING: no VW_AUTH_URL — the exe will call the committed auth root (http://localhost:8100).');
}

function replaceLine(source, name, value) {
  const line = new RegExp(`^export const ${name} = .*$`, 'm');
  if (!line.test(source)) throw new Error(`${name} line not found in src/embedded.ts`);
  return source.replace(line, () => `export const ${name} = '${value}';`);
}

function patch(kind) {
  let out = replaceLine(original, 'EMBEDDED_AGENT_KIND', kind);
  if (apiRoot) out = replaceLine(out, 'EMBEDDED_API_ROOT', apiRoot);
  if (authRoot) out = replaceLine(out, 'EMBEDDED_AUTH_ROOT', authRoot);
  return out;
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
}

let restored = false;
const restore = () => {
  if (restored) return;
  fs.writeFileSync(EMBEDDED, original, 'utf-8');
  restored = true;
  console.log('[bake] src/embedded.ts restored (committed defaults back in source)');
};
// Restore even if the build is interrupted.
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });

try {
  for (const kind of kinds) {
    console.log(`\n[bake] ── ${kind} ──`);
    fs.writeFileSync(EMBEDDED, patch(kind), 'utf-8');
    run('npx', ['tsc']);
    run('npx', ['pkg', 'dist/index.js', '--targets', 'node20-win-x64', '--output', OUTPUTS[kind]]);
    console.log(`[bake] built ${OUTPUTS[kind]}`);
  }
} finally {
  restore();
  // Recompile from the restored source so dist/ matches what is committed.
  try {
    run('npx', ['tsc']);
  } catch {
    console.warn('[bake] WARNING: could not recompile — delete dist/embedded.js by hand');
  }
}
