/**
 * Rewrite EMBEDDED_AGENT_KIND in src/embedded.ts before packaging.
 *
 * One agent codebase produces three exes — amazon, flipkart, noon — differing
 * only by this constant, which drives the home directory, the first-run
 * sign-in domain and the `agentKind` sent on check-in.
 *
 * Deliberately a surgical line replacement rather than rewriting the file:
 * `embedded.ts` also carries EMBEDDED_TOKEN and EMBEDDED_API_ROOT, and a
 * regenerate-the-whole-file approach silently drops any constant it does not
 * know about. (The CI workflow used to do exactly that, which is why adding
 * this constant would have broken the build.)
 *
 * Usage: node scripts/set-agent-kind.mjs <amazon|flipkart|noon>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KINDS = ['amazon', 'flipkart', 'noon'];

const kind = process.argv[2];
if (!KINDS.includes(kind)) {
  console.error(`set-agent-kind: expected one of ${KINDS.join(' | ')}, got ${kind ?? '(nothing)'}`);
  process.exit(1);
}

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'embedded.ts');
const before = readFileSync(file, 'utf-8');

const LINE = /^export const EMBEDDED_AGENT_KIND = '.*';$/m;
if (!LINE.test(before)) {
  // Failing loudly matters: a silent no-op here would ship three exes that all
  // think they are the Amazon agent, and they would collide on one device row.
  console.error(`set-agent-kind: no EMBEDDED_AGENT_KIND line found in ${file}`);
  process.exit(1);
}

const after = before.replace(LINE, `export const EMBEDDED_AGENT_KIND = '${kind}';`);
if (after !== before) writeFileSync(file, after, 'utf-8');
console.log(`set-agent-kind: ${kind}`);
