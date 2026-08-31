/**
 * Dev helper: cross-validate sponsored detection against independent signals.
 *
 *   npx tsx scripts/check-sponsored.ts "shampoo"
 *   npx tsx scripts/check-sponsored.ts "perfume" --short-code=NNSA
 *
 * Noon marks a paid placement with a small "Ad" pill at the bottom-left of the
 * product image, drawn as an inline <svg> of vector paths with NO text node.
 * That is why this script deliberately contains no text or raw-HTML string
 * check: a search for "sponsor"/"Ad" returns zero on a page that is 45% ads,
 * which is exactly how the label was missed in the first place.
 *
 * The signals below should agree. Where they don't, the disagreement tells you
 * which selector has drifted.
 *
 *   geoFooter — svg[viewBox="0 0 21 16"] inside the image overlay footer.
 *               Right place AND the badge's own geometry. This is the signal
 *               extractors.ts leads with.
 *   geoAny    — the same viewBox anywhere in the card. Survives a rename of
 *               the footer class.
 *   structural— any inline <svg> in the overlay footer. Survives a redraw of
 *               the badge, but see the WARNING below.
 *   textLabel — a node whose entire text is "Sponsored"/"Promoted"/"Ad".
 *               Forward-compat only; expected to be 0 until noon ships a real
 *               textual label.
 *
 * WARNING interpreting `structural`: the footer's other controls (wishlist,
 * add-to-cart) are <img>, not <svg>, which is the only reason it is safe today.
 * If it starts matching 100% of cards while geoFooter matches a minority, noon
 * has added an inline-SVG icon to the footer and that selector must be dropped
 * from SELECTORS.sponsoredBadge — a signal that fires on every card is worse
 * than no signal at all.
 */
import { chromium } from 'playwright';
import { config } from '../src/config';
import { resolveMarketplace } from '../src/marketplaces';
import { SELECTORS } from '../src/extractors';

const SIGNALS = {
  geoFooter: '[class*="_overlayFooter_"] svg[viewBox="0 0 21 16"]',
  geoAny: 'svg[viewBox="0 0 21 16"]',
  structural: '[class*="_overlayFooter_"] svg',
  textLabel:
    ':is(div,span,p):text-is("Sponsored"), :is(div,span,p):text-is("Promoted"), :is(div,span,p):text-is("Ad")',
} as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shortCode =
    args.find((a) => a.startsWith('--short-code='))?.split('=')[1] || 'NNAE';
  const terms = args.filter((a) => !a.startsWith('--'));
  const searchTerms = terms.length > 0 ? terms : ['shampoo', 'perfume'];
  const marketplace = resolveMarketplace(shortCode);

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
  page.setDefaultNavigationTimeout(90_000);

  try {
    for (const term of searchTerms) {
      await page.goto(
        `https://${marketplace.url}/${marketplace.locale}/search/?q=${encodeURIComponent(term)}&limit=50`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector(SELECTORS.resultCard, { timeout: 20_000 });
      for (let s = 0; s < 3; s++) {
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(400);
      }

      const cards = page.locator(SELECTORS.resultCard);
      const n = Math.min(await cards.count(), config.topNResults);
      const rows: Record<string, unknown>[] = [];
      let disagreements = 0;

      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const geoFooter = (await card.locator(SIGNALS.geoFooter).count()) > 0;
        const geoAny = (await card.locator(SIGNALS.geoAny).count()) > 0;
        const structural = (await card.locator(SIGNALS.structural).count()) > 0;
        const textLabel = (await card.locator(SIGNALS.textLabel).count()) > 0;
        // What extractors.ts would conclude — the OR of every signal.
        const detected = geoFooter || geoAny || structural || textLabel;
        // The two geometry signals are independent of each other's class hook,
        // so a split between them is the earliest sign of drift.
        const agree = geoFooter === geoAny;
        if (!agree) disagreements++;
        rows.push({
          pos: i + 1,
          geoFooter,
          geoAny,
          structural,
          textLabel,
          detected,
          agree: agree ? '' : ' MISMATCH',
        });
      }

      const count = (k: string) => rows.filter((r) => r[k]).length;
      console.log(`\n=== "${term}" on ${shortCode} (${marketplace.locale}) — ${n} cards ===`);
      console.table(rows);
      console.log(
        `geoFooter=${count('geoFooter')}  geoAny=${count('geoAny')}  ` +
          `structural=${count('structural')}  textLabel=${count('textLabel')}  ` +
          `DETECTED=${count('detected')}  disagreements=${disagreements}`,
      );

      if (count('detected') === n && n > 1) {
        console.log(
          '  VERDICT: every card flagged sponsored — a selector has gone broad.\n' +
            '  Most likely `structural` is catching a newly-added inline-SVG icon in\n' +
            '  the overlay footer. Drop it from SELECTORS.sponsoredBadge and re-run.',
        );
      } else if (count('detected') === 0) {
        console.log(
          '  VERDICT: no ads detected on this page. Noon normally seeds a\n' +
            '  minority of the grid with ads (~9 of the top 20 on uae-en), so zero is\n' +
            '  worth a second look — confirm visually that no card shows the small\n' +
            '  grey "Ad" pill at the bottom-left of the product image. If one does,\n' +
            '  the badge markup changed; capture it and update SELECTORS.sponsoredBadge.',
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
