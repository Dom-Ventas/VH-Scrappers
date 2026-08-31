import { chromium } from 'playwright';
import { buildProductUrl, buildReviewsUrl, toPdpSku } from './src/scraper';
import { resolveMarketplace } from './src/marketplaces';
import * as fs from 'fs';

const SHIM = 'window.__name = window.__name || function (fn) { return fn; };';
const q = JSON.parse(fs.readFileSync(
  '/private/tmp/claude-501/-Users-hemanthvarma426-noon-review-scrapper-v1/eb60dfba-4e28-4ace-b637-40f8acbf368a/scratchpad/q.json', 'utf8'));
const items = q.items.slice(0, 8);

(async () => {
  const ctx = await chromium.launchPersistentContext(
    '/private/tmp/claude-501/-Users-hemanthvarma426-noon-review-scrapper-v1/eb60dfba-4e28-4ace-b637-40f8acbf368a/scratchpad/p-verify',
    { headless: false, channel: 'chrome', viewport: { width: 1500, height: 950 },
      args: ['--disable-blink-features=AutomationControlled'] });
  await ctx.addInitScript({ content: SHIM });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);

  let ok = 0, bad = 0;
  for (const it of items) {
    const mp = resolveMarketplace(it.shortCode);
    const url = buildProductUrl(mp, it.sku);
    let status = -1;
    try {
      const r = await page.goto(url, { waitUntil: 'domcontentloaded' });
      status = r?.status() ?? -1;
    } catch (e) {
      console.log(`${it.sku}  goto ERR`); bad++; continue;
    }
    await page.waitForTimeout(2600);
    const info = await page.evaluate(() => {
      for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
        try { const j = JSON.parse(s.textContent || ''); const a = Array.isArray(j) ? j : [j];
          for (const x of a) if (x['@type'] === 'Product')
            return { sku: x.sku, name: (x.name||'').slice(0,42),
                     rating: x.aggregateRating?.ratingValue ?? 0,
                     count: x.aggregateRating?.reviewCount ?? 0 };
        } catch {}
      }
      return null;
    });
    if (info) { ok++; console.log(`OK   ${it.sku.padEnd(26)} -> ${toPdpSku(it.sku).padEnd(23)} http=${status} rating=${info.rating} n=${info.count}  "${info.name}"`); }
    else { bad++; console.log(`FAIL ${it.sku.padEnd(26)} -> ${toPdpSku(it.sku).padEnd(23)} http=${status} (no Product JSON-LD)`); }
  }
  console.log(`\nproduct pages: ${ok} ok, ${bad} failed  (all previously 404'd)`);
  console.log(`reviews URL example: ${buildReviewsUrl(resolveMarketplace(items[0].shortCode), items[0].sku)}`);
  await ctx.close();
})();
