/**
 * One-shot helper: open the persistent scrapper Chrome profile, navigate to
 * the given Amazon host, and set the delivery zip via the location popover.
 * The cookie persists in the profile dir, so subsequent `npm run dev` runs
 * will see the new zip.
 *
 * Usage:
 *   npx tsx scripts/set-amazon-zip.ts                     # defaults: amazon.com / 10001
 *   npx tsx scripts/set-amazon-zip.ts amazon.com 10001
 *   npx tsx scripts/set-amazon-zip.ts amazon.in 110001
 */
import { chromium } from 'playwright';
import { config } from '../src/config';

async function main() {
  const host = process.argv[2] || 'amazon.com';
  const zip = process.argv[3] || '10001';
  console.log(`[set-zip] host=${host} zip=${zip} profile=${config.profileDir}`);

  const ctx = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: ['--start-maximized'],
  });
  const page = await ctx.newPage();
  await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded' });

  // Open the location popover.
  await page.click('#nav-global-location-popover-link', { timeout: 15_000 });

  // Wait for the zip input inside the popover.
  const zipInput = page.locator('#GLUXZipUpdateInput');
  await zipInput.waitFor({ state: 'visible', timeout: 10_000 });
  await zipInput.fill(zip);

  // Click "Apply" — the visible button is inside #GLUXZipUpdate.
  await page.click('#GLUXZipUpdate input[type="submit"], #GLUXZipUpdate-announce', {
    timeout: 5_000,
  });

  // Amazon shows a "continue" / "done" affordance after applying. Wait then close popover.
  await page.waitForTimeout(2_500);
  // Click anywhere outside to dismiss popover, then reload to confirm.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const loc = await page
    .locator('#glow-ingress-block')
    .first()
    .textContent()
    .catch(() => null);
  console.log(`[set-zip] location pill now reads: ${(loc || '').trim().slice(0, 80)}`);

  await ctx.close();
  console.log('[set-zip] done.');
}

main().catch((e) => {
  console.error('[set-zip] FAILED:', e);
  process.exit(1);
});
