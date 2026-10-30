export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseIntSafe(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the star rating out of eBay's screen-reader text.
 *
 *   "4.5 out of 5 stars."               -> 4.5
 *   "4,5 von 5 Sternen"                 -> 4.5   (ebay.de)
 *   "88 product ratings"                -> null  (a count, not a rating)
 *
 * Only the "<n> out of 5" / "<n> von 5" shape is trusted; a bare number is
 * accepted only when it is already in range.
 */
export function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d(?:[.,]\d+)?)\s*(?:out of|von|sur|su|de)\s*5\b/i);
  const raw = m ? m[1] : /^\s*\d(?:[.,]\d+)?\s*$/.test(text) ? text.trim() : '';
  const n = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return n;
}

/**
 * Read eBay's product-ratings count. Only a labelled count is trusted — an
 * eBay card is full of other numbers ("851 sold", "54+ watchers", the seller's
 * "(33.1K)" feedback), none of which is a review count.
 *
 *   "4.0 out of 5 stars. 2 product ratings - Apple AirPods 4" -> 2
 *   "1,234 product ratings"                                    -> 1234
 *   "88 Produktbewertungen"                                    -> 88
 *   "851 sold"                                                 -> null
 */
export function parseReviewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d[\d,.]*)\s*(?:product ratings?|produktbewertungen|bewertungen|ratings?)\b/i);
  return m ? parseIntSafe(m[1]) : null;
}

/**
 * Read a price the way eBay prints it on a search card: one amount ("$15.49",
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

/**
 * Format a price the way the backend's parse_price() reads unambiguously:
 * "<ISO currency> <amount with a dot decimal>", e.g. "USD 15.49". Same shape
 * as the noon ("AED 165.30") and Otto ("EUR 1299.00") scrapers.
 */
export function formatPrice(amount: number | null, currency: string): string | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  return `${currency} ${amount.toFixed(2)}`;
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
 * Choose the delivery promise from a card's attribute rows.
 *
 * An eBay card prints a stack of short rows under the price:
 *   "Buy It Now" / "or Best Offer"      — the buying format
 *   "Free delivery in 2-3 days"         — the delivery promise (sometimes dated)
 *   "+$20.00 delivery"                  — a delivery COST, no date
 *   "Located in United States"          — item location
 *   "Free returns" / "851 sold"         — merchandising
 *
 * Only rows that talk about delivery are considered ("delivery", "shipping",
 * "postage", "get it", "Lieferung", "Versand"); "returns" rows are dropped.
 * Among the rest the EARLIEST date wins, and `deliveryText` is the row that
 * produced it. A delivery row with no date ("Free delivery") is still returned
 * as text with null days, so an audit can tell "no promise" from "unparsed".
 */
export function pickDelivery(lines: readonly string[], now: Date = new Date()): DeliveryPick {
  const candidates = lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(
      (l) =>
        l &&
        /\b(?:deliver|shipping|postage|get it|arrives|lieferung|versand|zustellung)/i.test(l) &&
        !/\b(?:returns?|rückversand|rücknahme)\b/i.test(l),
    );
  if (candidates.length === 0) return { deliveryText: null, deliveryDays: null };

  let best: DeliveryPick = { deliveryText: candidates[0], deliveryDays: null };
  for (const line of candidates) {
    const days = parseDeliveryDays(line, now);
    if (days === null) continue;
    if (best.deliveryDays === null || days < best.deliveryDays) {
      best = { deliveryText: line, deliveryDays: days };
    }
  }
  return best;
}
