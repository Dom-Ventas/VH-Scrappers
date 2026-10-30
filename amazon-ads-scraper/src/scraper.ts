import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { config, appDir } from './config';
import { Product } from './types';
import {
  extractProduct,
  extractSponsoredBrands,
  buildCardIndex,
  fetchProductFacts,
  CardFacts,
  PlacedProduct,
  SELECTORS,
} from './extractors';

/**
 * Page offset of every result card, in document coordinates.
 *
 * A string rather than a function so it survives `pkg` bytecode compilation —
 * see the note at its call site.
 */
const CARD_OFFSETS_SCRIPT = `(() => {
  var out = [];
  var cards = document.querySelectorAll('div[data-component-type="s-search-result"]');
  for (var i = 0; i < cards.length; i++) {
    var r = cards[i].getBoundingClientRect();
    out.push({
      y: Math.round(r.top + window.scrollY),
      x: Math.round(r.left + window.scrollX)
    });
  }
  return out;
})()`;

function buildSearchUrl(domain: string, searchTerm: string): string {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const q = encodeURIComponent(searchTerm.trim());
  return `https://${cleanDomain}/s?k=${q}`;
}

export async function scrapeSearchTerm(
  page: Page,
  domain: string,
  searchTerm: string,
): Promise<Product[]> {
  const url = buildSearchUrl(domain, searchTerm);
  console.log(`[SCRAPE] GET ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForSelector(SELECTORS.resultCard, {
      timeout: config.resultsWaitTimeoutMs,
    });
  } catch {
    throw new Error(
      `No search results loaded for "${searchTerm}" (possible CAPTCHA or block page).`,
    );
  }

  const cards = page.locator(SELECTORS.resultCard);
  const total = await cards.count();
  const limit = Math.min(total, config.maxCardsToScan);
  const want = config.productsPerBucket;

  // Where each card sits on the page, read in one atomic snapshot so a
  // late-loading image cannot shift the numbers between measurements.
  //
  // Passed as a STRING, not a function. `pkg` compiles this file to V8
  // bytecode, and Playwright serialises a passed function with
  // Function.prototype.toString() — on a bytecode-compiled function that
  // yields nothing usable, so it throws "Passed function is not
  // well-serializable!". It works under `npm run dev` and fails only in the
  // built exe. Every other in-page script here is a string for the same
  // reason; see the *_SCRIPT constants in extractors.ts.
  const cardOffsets = (await page.evaluate(CARD_OFFSETS_SCRIPT)) as Array<{
    y: number;
    x: number;
  }>;

  const products: PlacedProduct[] = [];
  let sponsoredSeen = 0;
  let organicSeen = 0;
  let skipped = 0;

  for (let i = 0; i < limit; i++) {
    // Stop as soon as both buckets are full. Amazon front-loads its ads, so
    // this usually lands around card 10 — but on a lopsided page it keeps
    // going instead of truncating a bucket at an arbitrary cut-off.
    if (sponsoredSeen >= want && organicSeen >= want) break;

    const at = cardOffsets[i] ?? { y: Number.MAX_SAFE_INTEGER, x: 0 };
    try {
      const product = await extractProduct(cards.nth(i), i + 1);
      if (product.isSponsored) sponsoredSeen++;
      else organicSeen++;
      products.push({ ...product, ...at });
    } catch (err) {
      // Skip the card rather than recording a placeholder. The placeholder was
      // pushed with isSponsored=false, so an unparseable card took a slot in
      // the organic bucket as a null-ASIN row and pushed a real result out.
      skipped++;
      console.warn(`[SCRAPE] Skipping unparseable card at position ${i + 1}:`, err);
    }
  }

  if (sponsoredSeen < want || organicSeen < want) {
    // Worth logging loudly: the usual cause is a search term with no ads on
    // page one, which no amount of scanning can fix.
    console.warn(
      `[SCRAPE] "${searchTerm}": only ${sponsoredSeen} sponsored / ${organicSeen} organic ` +
        `found in ${limit} of ${total} cards (wanted ${want} each)`,
    );
  }
  if (skipped > 0) console.warn(`[SCRAPE] "${searchTerm}": skipped ${skipped} unparseable card(s)`);

  // Sponsored Brands banners are not search-result cards, so they have to be
  // collected separately or the top-of-page ads are missed entirely. Safe to
  // do after the loop: the early stop only fires once BOTH buckets are full,
  // so a page whose ads live in banners is still scanned to maxCardsToScan.
  let banners: PlacedProduct[] = [];
  if (config.includeSponsoredBrands) {
    try {
      banners = await extractSponsoredBrands(page);
      if (banners.length > 0) {
        console.log(`[SCRAPE] "${searchTerm}": +${banners.length} Sponsored Brands product(s)`);
      }
    } catch (err) {
      // Never fail the whole scrape over the banner — the grid is the main event.
      console.warn(`[SCRAPE] "${searchTerm}": Sponsored Brands extraction failed:`, err);
    }
  }

  // Merge into true reading order: top-to-bottom, then left-to-right within a
  // row. `position` is assigned from this order, so the caller taking the
  // first N sponsored gets the first N ON THE PAGE, not the first N in the DOM.
  const merged = [...banners, ...products].sort((a, b) =>
    Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x,
  );

  // The same ASIN can be both a banner ad and a grid card. Keep ONE entry, at
  // its earliest page position, but fill blank fields from the later copy —
  // banner tiles carry no rating/review/delivery, while the grid card for the
  // same product carries all three. Without this the duplicate ate a second
  // competitor slot and the surviving row was the data-less one.
  // Enrich from any later copy of the same ASIN, but only DROP a duplicate
  // within the same bucket. A product can legitimately be both an ad and an
  // organic result — those are two real placements and both buckets need
  // their own row — whereas the same ASIN twice among the sponsored (banner
  // tile + grid card) is one placement counted twice, and it was eating a
  // second competitor slot with the data-less copy winning.
  const firstInBucket = new Map<string, PlacedProduct>();
  const deduped: PlacedProduct[] = [];
  for (const item of merged) {
    if (!item.asin) {
      deduped.push(item);
      continue;
    }
    const bucketKey = `${item.asin}::${item.isSponsored ? 'spon' : 'org'}`;
    const sameBucket = firstInBucket.get(bucketKey);
    if (sameBucket) {
      donate(sameBucket, item); // fold the duplicate in, don't emit a second row
      continue;
    }
    firstInBucket.set(bucketKey, item);
    deduped.push(item);
    // Backfill blanks on the copy already kept in the other bucket, and vice
    // versa: banner tiles have no rating/reviews/delivery, the grid card does.
    const otherKey = `${item.asin}::${item.isSponsored ? 'org' : 'spon'}`;
    const other = firstInBucket.get(otherKey);
    if (other) {
      donate(other, item);
      donate(item, other);
    }
  }

  const ordered = deduped.map(({ y: _y, x: _x, ...p }, i) => ({ ...p, position: i + 1 }));

  // Capture the search page BEFORE any product-page navigation takes us away
  // from it, so the PNG shows exactly what these positions were read from.
  if (config.saveScreenshots) {
    await saveSearchScreenshot(page, searchTerm);
  }

  if (banners.length > 0) {
    await fillBannerGaps(page, domain, searchTerm, ordered);
  }

  return ordered;
}

/** PNG of the search page as scraped, for auditing what was actually shown. */
async function saveSearchScreenshot(page: Page, searchTerm: string): Promise<void> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = searchTerm.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50);
    const dir = config.screenshotDir || path.join(appDir(), 'screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${stamp}_${slug}.png`);
    await page.screenshot({
      path: file,
      clip: { x: 0, y: 0, width: config.viewportWidth, height: 1600 },
    });
    console.log(`[SCRAPE] "${searchTerm}": page saved to ${file}`);
  } catch (err) {
    console.warn(`[SCRAPE] "${searchTerm}": screenshot failed:`, err);
  }
}

/**
 * Banner ads arrive without a delivery estimate, which the backend requires.
 * Fill the gaps in two passes, cheapest first.
 */
async function fillBannerGaps(
  page: Page,
  domain: string,
  searchTerm: string,
  products: Product[],
): Promise<void> {
  const needs = (p: Product) => p.deliveryDays === null || p.reviewCount === null || p.price === null;

  // Pass 1 (free): every grid card on the page, including ones past the point
  // the extraction loop stopped at.
  let index: Map<string, CardFacts>;
  try {
    index = await buildCardIndex(page);
  } catch (err) {
    console.warn(`[SCRAPE] "${searchTerm}": card index failed:`, err);
    return;
  }

  let fromPage = 0;
  for (const p of products) {
    if (!p.asin || !needs(p)) continue;
    const facts = index.get(p.asin);
    if (facts && applyFacts(p, facts)) fromPage++;
  }
  if (fromPage > 0) {
    console.log(`[SCRAPE] "${searchTerm}": filled ${fromPage} banner row(s) from the grid`);
  }

  if (!config.enrichFromProductPages) return;

  // Pass 2 (one navigation each): only rows that still lack delivery AND land
  // inside the buckets the backend will actually read. Anything below that is
  // not worth a page load.
  const sponsoredShortlist = products
    .filter((p) => p.isSponsored)
    .slice(0, config.productsPerBucket);
  const organicShortlist = products
    .filter((p) => !p.isSponsored)
    .slice(0, config.productsPerBucket);

  // Any missing required field is worth a fetch, not just delivery: the
  // backend drops a row lacking rating or review count just as readily, and a
  // dropped sponsored row gets backfilled from organic — which is how the same
  // ASIN ended up in the competitor list twice.
  const todo = [...sponsoredShortlist, ...organicShortlist]
    .filter((p) => p.asin && !isComplete(p))
    .slice(0, config.maxProductPageFetches);

  if (todo.length === 0) return;
  console.log(`[SCRAPE] "${searchTerm}": fetching ${todo.length} product page(s) for delivery`);

  let filled = 0;
  for (const p of todo) {
    const facts = await fetchProductFacts(page, domain, p.asin!);
    if (facts && applyFacts(p, facts)) filled++;
  }
  const stillShort = todo.filter((p) => !isComplete(p)).length;
  console.log(
    `[SCRAPE] "${searchTerm}": ${filled}/${todo.length} product page(s) filled` +
      (stillShort > 0 ? ` (${stillShort} still incomplete)` : ''),
  );
}

/**
 * A row the backend will accept. Anything missing here is discarded on their
 * side and its slot backfilled from organic, so it is worth skipping in
 * favour of the next complete product.
 */
export function isComplete(p: Product): boolean {
  return (
    p.asin !== null &&
    p.price !== null &&
    p.rating !== null &&
    p.reviewCount !== null &&
    p.deliveryDays !== null
  );
}

/** Fill only the blanks. Returns true if anything was filled. */
function applyFacts(p: Product, f: CardFacts): boolean {
  let changed = false;
  if (p.price === null && f.price !== null) { p.price = f.price; changed = true; }
  if (p.rating === null && f.rating !== null) { p.rating = f.rating; changed = true; }
  // `!== null` not truthiness — a genuine reviewCount of 0 must still apply.
  if (p.reviewCount === null && f.reviewCount !== null) { p.reviewCount = f.reviewCount; changed = true; }
  if (p.deliveryText === null && f.deliveryText !== null) { p.deliveryText = f.deliveryText; changed = true; }
  if (p.deliveryDays === null && f.deliveryDays !== null) { p.deliveryDays = f.deliveryDays; changed = true; }
  return changed;
}

/** Copy fields the target is missing from `from`. Never overwrites real data. */
function donate(target: Product, from: Product): void {
  if (target.rating === null) target.rating = from.rating;
  if (target.reviewCount === null) target.reviewCount = from.reviewCount;
  if (target.deliveryText === null) target.deliveryText = from.deliveryText;
  if (target.deliveryDays === null) target.deliveryDays = from.deliveryDays;
  if (target.price === null) target.price = from.price;
  if (target.title === null) target.title = from.title;
}
