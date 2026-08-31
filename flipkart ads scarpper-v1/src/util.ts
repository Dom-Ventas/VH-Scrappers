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

export function parseFloatSafe(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/[\d.]+/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Flipkart prints ratings and reviews in one string:
 *   "1,234 Ratings & 56 Reviews"
 *   "12,345 Ratings"
 * parseIntSafe() would concatenate both numbers into 123456, so pull the count
 * that directly precedes the word "Rating(s)". Falls back to the first number
 * in the string when the label is missing.
 */
export function parseRatingCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const labelled = text.match(/([\d,.\s]+)\s*ratings?/i);
  if (labelled) return parseIntSafe(labelled[1]);
  const first = text.match(/[\d,.]+/);
  return first ? parseIntSafe(first[0]) : null;
}

const MONTH_ABBRS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Parse Flipkart's delivery text and return the number of days from `now`
 * to the earliest promised delivery date.
 *
 * Handles the shapes Flipkart uses on the search grid:
 *   "Free delivery by Today"                    -> 0
 *   "Delivery by Tomorrow"                      -> 1
 *   "Delivery by Tue Aug 26"                    -> N   (month-day order)
 *   "Delivery by Sat, Aug 23 | Free ₹40"        -> N   (trailing fee ignored)
 *   "Delivery by 26 Aug"                        -> N   (day-month order)
 *   "Delivery by Aug 26 - 28"                   -> N   (picks start of range)
 *   "Delivery in 2 days"                        -> 2
 *   "Delivery in 3 - 5 days"                    -> 3   (picks start of range)
 *
 * When several dates appear in one line the earliest wins.
 * Returns null if no parseable date is found.
 */
export function parseDeliveryDays(
  text: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!text) return null;

  const today = startOfDay(now);
  const candidates: Date[] = [];

  if (/\btoday\b/i.test(text)) {
    candidates.push(today);
  }
  if (/\btomorrow\b/i.test(text)) {
    const d = new Date(today.getTime());
    d.setDate(d.getDate() + 1);
    candidates.push(d);
  }

  const pushDate = (day: number, monthIdx: number) => {
    if (day < 1 || day > 31 || monthIdx < 0) return;
    let year = today.getFullYear();
    const tentative = new Date(year, monthIdx, day);
    if (tentative.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
      year += 1;
    }
    candidates.push(new Date(year, monthIdx, day));
  };

  // day-month order: "26 Aug", "26 - 28 Aug"
  const dayMonthRe =
    /(\d{1,2})(?:\s*-\s*\d{1,2})?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
  let m: RegExpExecArray | null;
  while ((m = dayMonthRe.exec(text)) !== null) {
    pushDate(parseInt(m[1], 10), MONTH_ABBRS.indexOf(m[2].toLowerCase()));
  }

  // month-day order (Flipkart's usual form): "Aug 26", "Aug 26 - 28"
  const monthDayRe =
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{1,2})(?:\s*-\s*\d{1,2})?/gi;
  while ((m = monthDayRe.exec(text)) !== null) {
    pushDate(parseInt(m[2], 10), MONTH_ABBRS.indexOf(m[1].toLowerCase()));
  }

  // relative form: "in 2 days", "in 3 - 5 days", "within 4 days"
  const relativeRe = /\b(?:in|within)\s+(\d{1,2})(?:\s*-\s*\d{1,2})?\s*days?\b/gi;
  while ((m = relativeRe.exec(text)) !== null) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 90) {
      const d = new Date(today.getTime());
      d.setDate(d.getDate() + days);
      candidates.push(d);
    }
  }

  if (candidates.length === 0) return null;

  const earliest = candidates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  const diffMs = earliest.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
