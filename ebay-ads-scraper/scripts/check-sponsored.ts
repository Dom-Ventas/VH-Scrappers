/**
 * Dev helper: cross-validate sponsored detection against independent signals.
 *
 *   npx tsx scripts/check-sponsored.ts "bluetooth headphones"
 *   npx tsx scripts/check-sponsored.ts "yoga mat" --short-code=EBDE
 *
 * eBay plants a "Sponsored" label on EVERY card and hides it on organic ones
 * (see SPONSORED_PROBE in src/extractors.ts). Two signals read the label the
 * way a human sees it and should agree; a third is printed only to show it is
 * a decoy:
 *
 *   detected — what src/extractors.ts concludes (SVG painted onto a canvas).
 *   offsets  — the SVG <text>'s x+dx+translate / y+dy+translate land inside
 *              the label box (the fallback used when the canvas is unreadable).
 *   aria     — the label's aria-labelledby text. NOT a signal: eBay fills it
 *              at random. A "MISMATCH" in that column is expected.
 *
 * Measured 2026-10-14 on www.ebay.com, top 30 of four terms: 9-10 ads each,
 * detected == offsets on every card.
 */
import { config } from '../src/config';
import { launchChrome } from '../src/chromeProfile';
import { evaluateOnCard, probeSponsored, SELECTORS } from '../src/extractors';
import { resolveMarketplace } from '../src/marketplaces';
import { buildSearchUrl, isBlockPage } from '../src/scraper';

const OFFSETS_AND_ARIA = `(card) => {
  const b = card.querySelector('.s-card__sep > b');
  if (!b) return { offsets: false, aria: '' };
  const aria = (b.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
    .map((id) => (document.getElementById(id) || {}).textContent || '').join('').trim();
  const m = (b.getAttribute('style') || '').match(/base64,([^"')&]+)/);
  const svg = m ? new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))) : '';
  const t = svg.match(/<text\\b([^>]*)>/);
  if (!t) return { offsets: false, aria };
  const attr = (k) => { const mm = t[1].match(new RegExp('\\\\s' + k + "='(-?[\\\\d.]+)'")); return mm ? parseFloat(mm[1]) : 0; };
  const tr = t[1].match(/translate\\((-?[\\d.]+)[ ,]+(-?[\\d.]+)\\)/);
  const x = attr('x') + attr('dx') + (tr ? parseFloat(tr[1]) : 0);
  const y = attr('y') + attr('dy') + (tr ? parseFloat(tr[2]) : 0);
  const r = b.getBoundingClientRect();
  return { offsets: x > -4 && x < r.width && y > 0 && y <= r.height + 4, aria, xy: Math.round(x) + ',' + Math.round(y) };
}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shortCode = args.find((a) => a.startsWith('--short-code='))?.split('=')[1] || 'EBUS';
  const terms = args.filter((a) => !a.startsWith('--'));
  const searchTerms = terms.length > 0 ? terms : ['bluetooth headphones', 'yoga mat'];
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
        await page.waitForSelector(SELECTORS.resultCard, { timeout: 20_000, state: 'attached' });
      } catch {
        if (await isBlockPage(page)) {
          console.error(`"${term}": eBay served its bot check — complete it with BROWSER_VISIBLE=1 first.`);
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
        await card.scrollIntoViewIfNeeded().catch(() => {});
        const probe = await probeSponsored(card);
        const other = await evaluateOnCard<{ offsets: boolean; aria: string; xy?: string }>(card, OFFSETS_AND_ARIA);
        const ariaAd = /^(sponsored|anzeige)+$/i.test(other.aria);
        const agree = probe.sponsored === other.offsets;
        if (!agree) disagreements++;
        rows.push({
          pos: i + 1,
          detected: probe.sponsored,
          via: probe.method,
          offsets: other.offsets,
          xy: other.xy || '',
          aria: ariaAd,
          agree: agree ? '' : ' MISMATCH',
          itemId: (await card.getAttribute('data-listingid')) || '',
          label: probe.labels.map((l) => l.words).join('|'),
        });
      }

      console.log(`\n=== "${term}" on ${shortCode} (${marketplace.url}) — ${n} cards ===`);
      console.table(rows);
      const count = (k: string) => rows.filter((r) => r[k]).length;
      console.log(
        `DETECTED=${count('detected')}  offsets=${count('offsets')}  aria(decoy)=${count('aria')}  ` +
          `detected-vs-offsets disagreements=${disagreements}`,
      );
      if (count('detected') === n && n > 1) {
        console.log(
          '  VERDICT: every card flagged sponsored — eBay has changed how it hides the\n' +
            '  decoy label on organic cards. Screenshot a few cards and compare.',
        );
      } else if (count('detected') === 0) {
        console.log(
          '  VERDICT: no ads detected. Try a broad term ("bluetooth headphones") to\n' +
            '  confirm the label check still works before assuming eBay ran no ads.',
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
