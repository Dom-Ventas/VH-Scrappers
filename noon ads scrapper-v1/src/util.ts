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
 * Parse noon's review count.
 *
 * Noon compacts anything past a thousand — the card shows "15.8K", "1.6K",
 * "1.2M" — and prints smaller counts in full ("537", "29"). parseIntSafe()
 * would strip the suffix and the decimal point together and turn "15.8K" into
 * 158, so the multiplier has to be applied before the digits are flattened.
 *
 *   "537"    -> 537
 *   "1,234"  -> 1234
 *   "15.8K"  -> 15800
 *   "1.2M"   -> 1200000
 */
export function parseReviewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/([\d][\d.,]*)\s*([KMkm])?/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
  return Math.round(n * multiplier);
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
 * Parse noon's delivery text and return the number of days from `now` to the
 * earliest promised delivery date.
 *
 * Handles the shapes noon renders on the search grid:
 *   "GET IN 57 MINS"                  -> 0   (noon minutes / express)
 *   "GET IN 2 HOURS"                  -> 0
 *   "Get it Today"                    -> 0
 *   "Get it by Tomorrow"              -> 1
 *   "Get it by 27 Aug"                -> N   (day-month order — noon's usual)
 *   "Get it by Sat, 30 Aug"           -> N   (weekday prefix ignored)
 *   "Get it by Aug 30"                -> N   (month-day order)
 *   "Get it by 27 - 29 Aug"           -> N   (picks start of range)
 *   "Delivery in 2 days"              -> 2
 *   "Delivery in 3 - 5 days"          -> 3   (picks start of range)
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

  // Noon's express promise is sub-day ("GET IN 57 MINS", "GET IN 2 HOURS").
  // Anything measured in minutes or hours lands today, so it is 0 days out.
  // This has no Flipkart equivalent — Flipkart's grid carries no promise at all.
  if (/\b(?:in|within)\s+\d{1,3}\s*(?:min|mins|minute|minutes|hour|hours|hr|hrs)\b/i.test(text)) {
    candidates.push(today);
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

  // day-month order (noon's usual form): "27 Aug", "27 - 29 Aug"
  const dayMonthRe =
    /(\d{1,2})(?:\s*-\s*\d{1,2})?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
  let m: RegExpExecArray | null;
  while ((m = dayMonthRe.exec(text)) !== null) {
    pushDate(parseInt(m[1], 10), MONTH_ABBRS.indexOf(m[2].toLowerCase()));
  }

  // month-day order: "Aug 27", "Aug 27 - 29"
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
