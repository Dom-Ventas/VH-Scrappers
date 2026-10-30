export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A failure that will never succeed on a retry — an unknown item number, a
 * removed listing. retry() rethrows these immediately instead of burning attempts (and
 * page loads) on a result that cannot change.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export async function retry<T>(fn: () => Promise<T>, retries = 3, delayMs = 3_000): Promise<T> {
  let error: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      error = err;
      if (err instanceof PermanentError) throw err;
      if (i < retries) {
        console.warn(`[RETRY] attempt ${i}/${retries} failed, retrying in ${delayMs}ms:`, (err as Error).message);
        await sleep(delayMs);
      }
    }
  }
  throw error;
}

/**
 * Read a star rating out of eBay's screen-reader text.
 *
 *   "4.5 out of 5 stars"   -> 4.5
 *   "4,7 von 5 Sternen"    -> 4.7   (ebay.de)
 *   "72 product ratings"   -> null
 */
export function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d(?:[.,]\d+)?)\s*(?:out of|von)\s*5\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

/**
 * Read a count that may be compacted: "86K ratings" -> 86000,
 * "1.2M" -> 1200000, "4,502" -> 4502. Only an approximation when compacted —
 * the reviews page's `reviewCount` microdata carries the exact number and is
 * read first.
 */
export function parseCompactCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*([KMkm])?(?=\s*(?:ratings?|reviews?)\b|\s*$|\b)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = (m[2] || '').toLowerCase() === 'k' ? 1_000 : (m[2] || '').toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(n * mult);
}

/**
 * Read a price the way eBay prints it on a listing or search card: one amount ("$15.49",
 * "£37.09", "EUR 16,57", "AU $12.00") or a variation range ("$8.89 to
 * $10.49", "EUR 16,57 bis EUR 32,60") — the range's lower bound wins, like
 * Otto's "ab" price. Thousands separators are dropped.
 *
 * `decimalComma` says which separator is the decimal one: ebay.de prints
 * "EUR 1.234,56", ebay.com prints "$1,234.56".
 */
export function parseEbayPrice(text: string | null | undefined, decimalComma = false): number | null {
  if (!text) return null;
  const m = decimalComma
    ? text.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?!\d)/)
    : text.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/);
  if (!m) return null;
  const whole = m[1].replace(/[.,]/g, '');
  const n = parseFloat(`${whole}.${m[2] || '0'}`);
  return Number.isFinite(n) ? n : null;
}

/** English and German month tokens (ebay.com / .co.uk / .com.au / .de). */
const MONTH_TOKENS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, mär: 2, apr: 3, may: 4, mai: 4, jun: 5, jul: 6,
  aug: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dez: 11,
};
const MONTHS = Object.keys(MONTH_TOKENS).join('|');
const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6,
};

function monthIndex(token: string): number {
  const t = token.toLowerCase().replace(/\.$/, '');
  return MONTH_TOKENS[t.slice(0, 3)] ?? MONTH_TOKENS[t] ?? -1;
}

function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Parse eBay's delivery text and return the number of days from `now` to the
 * earliest promised delivery date.
 *
 * Handles the shapes eBay prints on search cards:
 *   "Free delivery in 2-3 days"            -> 2   (start of range)
 *   "Delivery in 4 days"                   -> 4
 *   "Get it by Fri, Oct 17"                -> N
 *   "Est. delivery Thu, Oct 16 - Tue, Oct 21" -> N (earliest of the range)
 *   "Get it tomorrow" / "today"            -> 1 / 0
 *   "Lieferung bis Do, 16. Okt"            -> N   (ebay.de: day-month)
 *   "Lieferung in 2-4 Tagen"               -> 2
 *   "Free delivery" / "+$20.00 delivery"   -> null (a cost, not a date)
 *
 * When several dates appear in one line the earliest wins. Returns null if no
 * parseable date is found.
 */
export function parseDeliveryDays(
  text: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!text) return null;

  const today = startOfDay(now);
  const candidates: Date[] = [];
  const pushOffset = (days: number) => {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + days);
    candidates.push(d);
  };

  if (/\b(?:today|heute)\b/i.test(text)) pushOffset(0);
  if (/\b(?:tomorrow|morgen)\b/i.test(text)) pushOffset(1);

  const pushDate = (day: number, monthIdx: number) => {
    if (day < 1 || day > 31 || monthIdx < 0 || monthIdx > 11) return;
    let year = today.getFullYear();
    const tentative = new Date(year, monthIdx, day);
    if (tentative.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
      year += 1;
    }
    candidates.push(new Date(year, monthIdx, day));
  };

  let m: RegExpExecArray | null;

  // month-day order (ebay.com): "Oct 17", "Fri, Oct 17", "Oct 16 - 21".
  // (?!\d) keeps a trailing year ("Oct 14, 2026") from being read as day 20.
  const monthDayRe = new RegExp(`(?<![\\p{L}])(${MONTHS})[\\p{L}]*\\.?,?\\s+(\\d{1,2})(?![\\d.])`, 'giu');
  while ((m = monthDayRe.exec(text)) !== null) {
    pushDate(parseInt(m[2], 10), monthIndex(m[1]));
  }

  // day-month order (ebay.de / .co.uk / .com.au): "16. Okt", "16 Oct", "16.10."
  const dayMonthRe = new RegExp(`(?<![\\d/.,$€£])(\\d{1,2})\\.?\\s*(?:[-–]\\s*\\d{1,2}\\.?\\s*)?(${MONTHS})[\\p{L}]*\\.?(?![\\p{L}])`, 'giu');
  while ((m = dayMonthRe.exec(text)) !== null) {
    pushDate(parseInt(m[1], 10), monthIndex(m[2]));
  }
  const numericDeRe = /(?<![\d.,$€£])(\d{1,2})\.(\d{1,2})\.(?!\d)/g;
  while ((m = numericDeRe.exec(text)) !== null) {
    pushDate(parseInt(m[1], 10), parseInt(m[2], 10) - 1);
  }

  // relative form: "in 2-3 days", "in 4 days", "in 2-4 Tagen", "within 5 business days"
  const relativeRe = /\b(?:in|within|innerhalb von)\s+(\d{1,2})\s*\+?(?:\s*[-–]\s*\d{1,2})?\s*(?:business\s+|werk)?(?:days?|tagen?|werktagen?)\b/gi;
  while ((m = relativeRe.exec(text)) !== null) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 90) pushOffset(days);
  }

  // weekday only ("Get it by Fri"): the next such day. A weekday that is
  // today would have said "today", so a match on today's name means next week.
  if (candidates.length === 0) {
    const wd = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);
    if (wd) {
      const target = WEEKDAYS[wd[1].toLowerCase()];
      const diff = (target - today.getDay() + 7) % 7;
      pushOffset(diff === 0 ? 7 : diff);
    }
  }

  if (candidates.length === 0) return null;

  const earliest = candidates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  const diffMs = earliest.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export interface DeliveryPick {
  deliveryText: string | null;
  deliveryDays: number | null;
}

/**
 * Read the listing page's "Delivery:" (or "Shipping:") row — eBay's own
 * estimate for the location the session ships to:
 *
 *   "Estimated between Fri, Oct 16 and Tue, Oct 20 to 10001"   -> earliest, Oct 16
 *   "Free 2-4 day delivery Get it between Fri, Oct 16 and Mon, Oct 19 to 10001." -> Oct 16
 *   "Lieferung zwischen Di, 10. Nov und Fr, 20. Nov nach 10115 bei heutigem
 *    Zahlungseingang Verkäufer verschickt innerhalb von 1 Tag …" -> 10 Nov
 *
 * The cell often runs on with handling-time and import-fee sentences ("Seller
 * ships within 1 day", "Verkäufer verschickt innerhalb von 1 Tag") that are
 * NOT a delivery promise, so the text is cut there and the first part that
 * holds a date wins. The postcode at the end ("to 10001") is never read as a
 * date. Text without a date ("Varies") is kept with null days, so an audit can
 * tell "no promise" from "unparsed".
 */
export function pickDelivery(text: string | null | undefined, now: Date = new Date()): DeliveryPick {
  const line = normalizeText(text);
  if (!line) return { deliveryText: null, deliveryDays: null };
  const parts = line
    .split(/\b(?:seller ships|ships within|see details|verkäufer verschickt|details anzeigen|bei der lieferung fallen|import charges)\b/i)[0]
    .split(/(?<=[^\d\s]\.)\s+(?=[A-ZÄÖÜ])|(?=\b(?:Get it|Estimated|Lieferung|Voraussichtlich)\b)/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const days = parseDeliveryDays(part, now);
    if (days !== null) return { deliveryText: part, deliveryDays: days };
  }
  return { deliveryText: parts[0] || line, deliveryDays: null };
}
