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
 * Parse Amazon's delivery text and return the number of days from `now`
 * to the earliest promised delivery date.
 *
 * Handles:
 *   "FREE delivery Today"                             -> 0
 *   "FREE delivery Tomorrow, 9 Apr"                   -> 1
 *   "FREE delivery Fri, 10 Apr"                       -> 2 (if today is 8 Apr)
 *   "FREE delivery 10 - 14 Apr"                       -> 2 (picks the start of the range)
 *   "FREE delivery Fri, 10 Apr\nOr fastest delivery Tomorrow, 9 Apr" -> 1 (earliest wins)
 *   "FREE delivery Mon, 13 Apr on first order"        -> 5
 *
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

  // Match "10 Apr" and "10 - 14 Apr" (start day of a range).
  // The non-capturing "(?:\s*-\s*\d{1,2})?" consumes the end of a range so we
  // don't also match "14 Apr" as a separate candidate.
  const dateRe =
    /(\d{1,2})(?:\s*-\s*\d{1,2})?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const monthIdx = MONTH_ABBRS.indexOf(m[2].toLowerCase());
    if (day < 1 || day > 31 || monthIdx < 0) continue;

    // Infer year: if the month has already passed this year (or is the current
    // month but the day has already passed), the delivery is in the next year.
    let year = today.getFullYear();
    const tentative = new Date(year, monthIdx, day);
    if (tentative.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
      year += 1;
    }
    candidates.push(new Date(year, monthIdx, day));
  }

  if (candidates.length === 0) return null;

  const earliest = candidates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  const diffMs = earliest.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
