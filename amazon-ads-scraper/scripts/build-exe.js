#!/usr/bin/env node
/**
 * Builds the Windows exe with the VentaWiz API root and auth root BAKED IN.
 *
 * This is the local-build equivalent of what
 * .github/workflows/build-windows-agent.yml does in CI: it patches
 * src/embedded.ts just before packaging, and the file is ALWAYS restored
 * afterwards so the committed localhost defaults stay in source.
 *
 * No secret is baked in. The exe authenticates with a VentaWiz service
 * account (VW_CLIENT_ID / VW_CLIENT_SECRET) that the VentaWiz agent passes in,
 * or that a standalone run reads from its .env.
 *
 * Usage:  npm run build:exe
 * Values come from .env (or real env vars, which win):
 *   VH_API_ROOT  - optional; defaults to whatever is committed in embedded.ts
 *   VW_AUTH_URL  - optional; defaults to whatever is committed in embedded.ts
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config();

const EMBEDDED = path.join(__dirname, '..', 'src', 'embedded.ts');
const original = fs.readFileSync(EMBEDDED, 'utf-8');

const apiRoot = (process.env.VH_API_ROOT || '').trim().replace(/\/+$/, '');
const authRoot = (process.env.VW_AUTH_URL || '').trim().replace(/\/+$/, '');

function patch(source) {
  let out = source;

  if (apiRoot) {
    out = out.replace(
      /^export const EMBEDDED_API_ROOT = .*$/m,
      `export const EMBEDDED_API_ROOT = '${apiRoot}';`,
    );
    if (!out.includes(`EMBEDDED_API_ROOT = '${apiRoot}'`)) {
      throw new Error('api root injection failed — EMBEDDED_API_ROOT line not found');
    }
  }

  if (authRoot) {
    out = out.replace(
      /^export const EMBEDDED_AUTH_ROOT = .*$/m,
      `export const EMBEDDED_AUTH_ROOT = '${authRoot}';`,
    );
    if (!out.includes(`EMBEDDED_AUTH_ROOT = '${authRoot}'`)) {
      throw new Error('auth root injection failed — EMBEDDED_AUTH_ROOT line not found');
    }
  }

  return out;
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: path.join(__dirname, '..'), shell: process.platform === 'win32' });
}

console.log(`[bake] VH_API_ROOT : ${apiRoot || '(keeping committed value)'}`);
console.log(`[bake] VW_AUTH_URL : ${authRoot || '(keeping committed value)'}`);

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
  fs.writeFileSync(EMBEDDED, patch(original), 'utf-8');
  run('npx', ['tsc']);
  run('npx', [
    'pkg', 'dist/index.js',
    '--targets', 'node20-win-x64',
    '--output', 'dist/search-term-scrapper.exe',
  ]);
  console.log('\n[bake] built dist/search-term-scrapper.exe');
} finally {
  restore();
  // Recompile from the restored source so dist/ matches what is committed.
  try {
    run('npx', ['tsc']);
  } catch {
    console.warn('[bake] WARNING: could not recompile — delete dist/embedded.js by hand');
  }
}
