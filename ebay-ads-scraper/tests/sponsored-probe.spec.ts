import { test, expect } from '@playwright/test';
import { chromium, Browser, Page } from 'playwright';
import { probeSponsored, SELECTORS } from '../src/extractors';

/**
 * Offline check of the sponsored probe against eBay's real label markup,
 * captured from www.ebay.com on 2026-10-14. Every card carries the same
 * `.s-card__sep > b` with a "Sponsored" SVG background, a transparent
 * "derosnopS" decoy span and aria-labelledby ids; only where the SVG draws
 * its text differs. Runs in installed Chrome (no network needed).
 */

const b64 = (svg: string) => Buffer.from(svg, 'utf8').toString('base64');

// On an ad the offsets net to (0.03, 11.5) — inside the 65×15 box.
const AD_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' version='1.1'><text font-size='12' dy='-38.18913871340426' " +
  "dx='-35.52290145270639' fill='#707070' font-family='Market Sans,Arial,sans-serif' x='35.33855986879049' " +
  "transform='translate(0.2110901204499399 81.07464116829561)' y='-31.37595701613233'>Sponѕor⁧ed</text></svg>";
// On an organic card they net to (-37.95, -33.88) — off-canvas, nothing painted.
const ORGANIC_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' version='1.1'><text dx='39.10140633660825' font-size='12' " +
  "transform='translate(-39.296768482839425 -35.78325107855085)' dy='36.936681030487605' x='-37.75560704056169' " +
  "y='-35.03705902345195' font-family='Market Sans,Arial,sans-serif' fill='#707070'>Sp⁦onsоred</text></svg>";

function card(id: string, svg: string, ariaTarget: string): string {
  return `
    <li class="s-card" data-listingid="${id}">
      <div class="s-card__title"><span class="su-styled-text primary default">Item ${id}</span><span class="clipped">Opens in a new window or tab</span></div>
      <div class="s-card__footer"><div class="s-card__footer--row"><div class="s-card__sep">
        <b aria-labelledby="${ariaTarget}" role="heading" aria-level="6"
           style="background-image: url(&quot;data:image/svg+xml;base64,${b64(svg)}&quot;);"><span aria-hidden="true" style="color: transparent !important">derosnopS</span></b>
      </div></div></div>
    </li>`;
}

const PAGE = `<!doctype html><html><head><style>
  .s-card__sep b { display: inline-block; width: 65px; height: 15px; background-repeat: no-repeat; }
  .clipped { position: absolute; clip: rect(1px,1px,1px,1px); }
</style></head><body>
  <div id="lbl-yes">Sponsored</div>
  <div class="s-clipped" aria-hidden="true">${card('2500219655424533', AD_SVG, 'lbl-yes')}</div>
  <ul class="srp-results">
    ${card('405662453606', AD_SVG, 'missing-id')}
    ${card('278359685103', ORGANIC_SVG, 'lbl-yes')}
    ${card('205556223087', ORGANIC_SVG, 'missing-id')}
    <li class="s-card" data-listingid="166819315978"><span style="color: transparent">Sponsored</span></li>
    <li class="s-card" data-listingid="166819315979"><span>Sponsored</span></li>
  </ul>
</body></html>`;

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.setContent(PAGE);
});

test.afterAll(async () => {
  await browser?.close();
});

test('result cards exclude the hidden decoy card outside the list', async () => {
  const ids = await page.locator(SELECTORS.resultCard).evaluateAll((els) => els.map((e) => e.getAttribute('data-listingid')));
  expect(ids).toEqual(['405662453606', '278359685103', '205556223087', '166819315978', '166819315979']);
});

test('the painted label marks the ad, whatever aria-labelledby says', async () => {
  const cards = page.locator(SELECTORS.resultCard);
  const ad = await probeSponsored(cards.nth(0));
  expect(ad.sponsored).toBe(true);
  expect(ad.method).toBe('canvas');
  expect(ad.labels[0].words).toBe('Sponsored');
});

test('an off-canvas label is organic, even with aria pointing at "Sponsored"', async () => {
  const cards = page.locator(SELECTORS.resultCard);
  expect((await probeSponsored(cards.nth(1))).sponsored).toBe(false);
  expect((await probeSponsored(cards.nth(2))).sponsored).toBe(false);
});

test('plain-text label counts only when it is actually painted', async () => {
  const cards = page.locator(SELECTORS.resultCard);
  expect((await probeSponsored(cards.nth(3))).sponsored).toBe(false);
  const visible = await probeSponsored(cards.nth(4));
  expect(visible.sponsored).toBe(true);
  expect(visible.method).toBe('text');
});
