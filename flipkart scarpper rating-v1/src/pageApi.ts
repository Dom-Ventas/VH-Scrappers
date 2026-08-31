// ─── FLIPKART PAGE-DATA API ───────────────────────────────────────────────────
// Flipkart's pages are React-Native-Web apps whose markup carries no stable
// classes, ids or data-attributes (every node is `css-g5y9jx`), and which
// lazy-render whole sections unreliably — on one sampled product only 1 of 18
// rich-content images ever rendered, and long review bodies render clipped with
// a "...more" control that ignores synthetic clicks.
//
// The same pages are backed by /api/4/page/fetch, which returns the whole page
// model as typed widgets. That gives the scraper the same shape the Amazon
// scraper gets from the DOM — a list of review units with named fields — rather
// than text that has to be re-parsed, and it returns review bodies in full.
//
// It is an internal, undocumented endpoint: treat every field as optional and
// always keep a fallback path. Callers must be on a flipkart.com page so the
// request carries the right origin and session cookies.

import { Page } from 'playwright';

export interface PageSlot {
  widget?: {
    type?: string;
    data?: any;
  };
}

export interface PageData {
  RESPONSE?: {
    slots?: PageSlot[];
  };
}

const ENDPOINT = 'https://www.flipkart.com/api/4/page/fetch';

export function productPageUri(pid: string): string {
  return `/product/p/itme?pid=${pid}`;
}

export function reviewPageUri(
  pid: string,
  pageNumber: number
): string {
  return (
    `/product/product-reviews/itme` +
    `?pid=${pid}&sortOrder=MOST_RECENT&page=${pageNumber}`
  );
}

async function fetchPageDataOnce(
  page: Page,
  uri: string
): Promise<PageData | null> {

  try {

    const data = await page.evaluate(
      async ({ endpoint, pageUri }: { endpoint: string; pageUri: string }) => {

        const res = await fetch(
          endpoint,
          {
            method: 'POST',

            credentials: 'include',

            headers: {
              'Content-Type': 'application/json',

              'X-User-Agent':
                navigator.userAgent +
                ' FKUA/website/42/website/Desktop'
            },

            body: JSON.stringify({ pageUri })
          }
        );

        if (!res.ok) {
          return null;
        }

        return res.json();
      },
      { endpoint: ENDPOINT, pageUri: uri }
    );

    if (!data) {
      console.warn(`[PAGE API] ${uri} -> non-OK response`);
      return null;
    }

    return data as PageData;

  } catch (err) {

    console.warn(`[PAGE API] ${uri} -> request failed`, err);

    return null;
  }
}

/** Widget type names present on the page — handy when a field goes missing. */
export function widgetTypes(
  data: PageData | null
): string[] {

  return (data?.RESPONSE?.slots ?? [])
    .map(s => s?.widget?.type)
    .filter((t): t is string => Boolean(t));
}

export function findWidget(
  data: PageData | null,
  type: string
): any | null {

  const slot = (data?.RESPONSE?.slots ?? [])
    .find(s => s?.widget?.type === type);

  return slot?.widget?.data ?? null;
}

/** Every widget of a type. The review page emits one REVIEWS widget per review. */
export function findWidgets(
  data: PageData | null,
  type: string
): any[] {

  return (data?.RESPONSE?.slots ?? [])
    .filter(s => s?.widget?.type === type)
    .map(s => s!.widget!.data)
    .filter(Boolean);
}

/**
 * Whether a response is actually a product page. Every product page carries
 * breadcrumbs and a summary widget; a response missing them is an interstitial,
 * a login wall or a throttled stub. Treating one of those as "this product has
 * no A+ content" would invent data, so callers check this before trusting a
 * negative.
 */
export function looksLikeProductPage(
  data: PageData | null
): boolean {

  const types = widgetTypes(data);

  return (
    types.includes('PRODUCT_BREADCRUMBS') &&
    types.some(t => t.startsWith('PRODUCT_PAGE_SUMMARY'))
  );
}

/**
 * Whether a response is a review page. RATING (the star histogram) and
 * PRODUCT_MIN are present even when a page carries no reviews, so this stays
 * true for a legitimately empty last page — which must read as "no more
 * reviews", not as a failed request.
 */
export function looksLikeReviewPage(
  data: PageData | null
): boolean {

  const types = widgetTypes(data);

  return (
    types.includes('RATING') ||
    types.includes('PRODUCT_MIN') ||
    types.includes('REVIEWS')
  );
}

/**
 * Retries once on a degraded response. Flipkart intermittently returns a stub
 * page under load — observed in a real run where three products in a row came
 * back with no RPD widget and therefore reported "no A+ content", which was
 * wrong for two of them. A single retry costs little and turns a silent data
 * error into a transient blip.
 */
async function fetchWithRetry(
  page: Page,
  uri: string,
  isUsable: (data: PageData | null) => boolean,
  label: string,
  attempts: number
): Promise<PageData | null> {

  let last: PageData | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {

    last = await fetchPageDataOnce(page, uri);

    if (isUsable(last)) {
      return last;
    }

    if (attempt < attempts) {
      console.warn(
        `[PAGE API] ${label} -> degraded response ` +
          `(${widgetTypes(last).length} widget(s), unexpected layout), retrying`
      );

      await page.waitForTimeout(1500);
    }
  }

  return last;
}

export function fetchPageData(
  page: Page,
  pid: string,
  attempts = 2
): Promise<PageData | null> {

  return fetchWithRetry(
    page,
    productPageUri(pid),
    looksLikeProductPage,
    pid,
    attempts
  );
}

export function fetchReviewPageData(
  page: Page,
  pid: string,
  pageNumber: number,
  attempts = 2
): Promise<PageData | null> {

  return fetchWithRetry(
    page,
    reviewPageUri(pid, pageNumber),
    looksLikeReviewPage,
    `${pid} reviews p${pageNumber}`,
    attempts
  );
}

/** Total review pages available, from the pagination widget. null when absent. */
export function reviewTotalPages(
  data: PageData | null
): number | null {

  const bar = findWidget(data, 'PAGINATION_BAR');

  const total = Number(bar?.totalPages);

  return Number.isFinite(total) && total > 0 ? total : null;
}
