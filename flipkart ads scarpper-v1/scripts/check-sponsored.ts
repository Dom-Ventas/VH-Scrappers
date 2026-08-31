/**
 * Dev helper: cross-validate sponsored detection against independent signals.
 *
 *   npx tsx scripts/check-sponsored.ts "boat ear buds"
 *
 * Flipkart exposes ad placements three ways. They should agree; where they
 * don't, the disagreement tells you which selector has drifted.
 *
 *   adview  — a descendant with data-tkid="ADVIEW_..." (what extractors.ts uses)
 *   enTkid  — the CARD's own data-tkid: paid slots carry an encrypted "en_"
 *             token, organic ones carry "<uuid>.<PID>.SEARCH". Note the prefix
 *             is one underscore; the token itself often starts with another,
 *             so "en__" matches only some ads.
 *   svgBadge— div.IxWX8O, the wrapper around the "Sponsored" vector graphic
 */
import { chromium } from 'playwright';
import { config } from '../src/config';

async function main(): Promise<void> {
  const terms = process.argv.slice(2);
  const searchTerms = terms.length > 0 ? terms : ['boat ear buds', 'smart watches'];

  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    // Default to real Chrome, matching src/browser.ts — the persistent profile
    // is created by Chrome, and opening it with bundled Chromium can corrupt
    // the saved login. PW_CHANNEL=chromium opts out where Chrome is unavailable.
    channel: process.env.PW_CHANNEL === 'chromium' ? undefined : config.chromeChannel,
    viewport: null,
    args: [
      '--window-position=-32000,-32000',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const page = await context.newPage();

  try {
    for (const term of searchTerms) {
      await page.goto(
        `https://${config.defaultFlipkartDomain}/search?q=${encodeURIComponent(term)}&marketplace=FLIPKART`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('div[data-id]', { timeout: 20_000 });
      for (let s = 0; s < 3; s++) {
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(400);
      }

      const cards = page.locator('div[data-id]');
      const n = Math.min(await cards.count(), config.topNResults);
      const rows: Record<string, unknown>[] = [];
      let disagreements = 0;

      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const adview = (await card.locator('[data-tkid^="ADVIEW_"]').count()) > 0;
        const svgBadge = (await card.locator('div.IxWX8O').count()) > 0;
        // List layout writes the label as text; grid layout draws it as an SVG.
        const textBadge = /(?:^|\n)\s*Sponsored\s*(?:\n|$)/i.test(await card.innerText());
        // The card's own tracking id lives on its first child div.
        const ownTkid = (await card.locator('> div[data-tkid]').first().getAttribute('data-tkid')) || '';
        const enTkid = ownTkid.startsWith('en_');
        // What extractors.ts would conclude — the OR of every signal.
        const detected = adview || enTkid || svgBadge || textBadge;
        // Any signal firing while the detector says "organic" is the failure
        // mode that matters: a real ad counted as organic.
        const agree = adview === enTkid;
        if (!agree) disagreements++;
        rows.push({
          pos: i + 1,
          adview,
          enTkid,
          svgBadge,
          textBadge,
          detected,
          agree: agree ? '' : ' MISMATCH',
          tkid: ownTkid.slice(0, 22),
        });
      }

      console.log(`\n=== "${term}" (${n} cards) ===`);
      console.table(rows);
      console.log(
        `adview=${rows.filter((r) => r.adview).length}  ` +
          `enTkid=${rows.filter((r) => r.enTkid).length}  ` +
          `svgBadge=${rows.filter((r) => r.svgBadge).length}  ` +
          `textBadge=${rows.filter((r) => r.textBadge).length}  ` +
          `DETECTED=${rows.filter((r) => r.detected).length}  ` +
          `disagreements=${disagreements}`,
      );
      if (rows.every((r) => !r.detected)) {
        console.log(
          '  note: zero ads on this page for THIS browser session. Flipkart ' +
            'personalises ad slots, so a logged-in profile may see ads where a ' +
            'fresh one sees none. Re-run against your real profile to compare:\n' +
            '  SCRAPER_PROFILE_DIR="$HOME/AppData/Local/FlipkartSearchTermScrapper/chrome-profile" \\\n' +
            '    npx tsx scripts/check-sponsored.ts "laptop"',
        );
      }
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
