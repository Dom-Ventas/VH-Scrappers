/**
 * Dev helper: cross-validate sponsored detection against independent signals.
 *
 *   npx tsx scripts/check-sponsored.ts "bluetooth headphones"
 *   npx tsx scripts/check-sponsored.ts "air fryer" --short-code=WMUS
 *
 * Walmart marks a paid grid placement three ways. They should agree; where
 * they don't, the disagreement tells you which selector has drifted.
 *
 *   tag   — the `gpt-sponsored-tag-container` element (server-rendered).
 *   text  — a node whose entire text is "Sponsored".
 *   track — the tile's main link goes through the `/sp/track?` ad-click
 *           redirect instead of straight to `/ip/…`.
 *
 * `detected` is what src/extractors.ts concludes (the OR of all three).
 * Measured 2026-10-13 on "bluetooth headphones": 12 of 52 tiles, all three
 * signals agreeing on every tile.
 */
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { detectSponsored, isAdHref, SELECTORS } from '../src/extractors';
import { resolveMarketplace } from '../src/marketplaces';
import { buildSearchUrl, isBlockPage } from '../src/scraper';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shortCode = args.find((a) => a.startsWith('--short-code='))?.split('=')[1] || 'WMUS';
  const terms = args.filter((a) => !a.startsWith('--'));
  const searchTerms = terms.length > 0 ? terms : ['bluetooth headphones', 'air fryer'];
  const marketplace = resolveMarketplace(shortCode);

  const context = await launchChrome(config.profileDir, {
    headless: false,
    channel: config.chromeChannel,
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
      await page.goto(buildSearchUrl(marketplace, term), { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForSelector(SELECTORS.resultCard, { timeout: 20_000 });
      } catch {
        if (await isBlockPage(page)) {
          console.error(`"${term}": Walmart served the "Robot or human?" check — complete it with BROWSER_VISIBLE=1 first.`);
          continue;
        }
        throw new Error(`"${term}": no result cards found`);
      }

      const cards = page.locator(SELECTORS.resultCard);
      const n = Math.min(await cards.count(), config.topNResults);
      const rows: Record<string, unknown>[] = [];
      let disagreements = 0;

      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const tag = (await card.locator(SELECTORS.sponsoredTag).count()) > 0;
        const text = (await card.locator(SELECTORS.sponsoredText).count()) > 0;
        const href = await card.locator(SELECTORS.mainLink).first().getAttribute('href').catch(() => null);
        const track = isAdHref(href);
        const detected = await detectSponsored(card);
        const agree = tag === text && text === track;
        if (!agree) disagreements++;
        rows.push({
          pos: i + 1,
          tag,
          text,
          track,
          detected,
          agree: agree ? '' : ' MISMATCH',
          wpid: (await card.getAttribute('data-item-id')) || '',
          itemId: (await card.getAttribute('data-dca-id')) || '',
        });
      }

      console.log(`\n=== "${term}" on ${shortCode} (${marketplace.url}) — ${n} cards ===`);
      console.table(rows);
      const count = (k: string) => rows.filter((r) => r[k]).length;
      console.log(
        `tag=${count('tag')}  text=${count('text')}  track=${count('track')}  ` +
          `DETECTED=${count('detected')}  disagreements=${disagreements}`,
      );
      if (count('detected') === n && n > 1) {
        console.log(
          '  VERDICT: every card flagged sponsored — a signal has gone broad.\n' +
            '  Check which column is all-true and fix that selector in SELECTORS.',
        );
      } else if (count('detected') === 0) {
        console.log(
          '  VERDICT: no ads detected. Walmart only shows sponsored tiles for terms\n' +
            '  advertisers bid on, so a niche term can genuinely have none. Try a broad\n' +
            '  term ("laptop") to confirm the selectors still work before assuming drift.',
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
