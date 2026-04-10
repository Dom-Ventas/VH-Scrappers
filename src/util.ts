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
 * Handles two date orderings:
 *   day-month (amazon.in, .co.uk, .de, etc.):
 *     "FREE delivery Today"                             -> 0
 *     "FREE delivery Tomorrow, 9 Apr"                   -> 1
 *     "FREE delivery Fri, 10 Apr"                       -> 2 (if today is 8 Apr)
 *     "FREE delivery 10 - 14 Apr"                       -> 2 (picks start of range)
 *     "FREE delivery Mon, 13 Apr on first order"        -> 5
 *   month-day (amazon.com):
 *     "FREE delivery Apr 15"                            -> N
 *     "FREE delivery Wed, Apr 15"                       -> N
 *     "FREE delivery Apr 15 - 17"                       -> N (picks start of range)
 *
 * Combined lines like "FREE delivery ... Or fastest delivery ..." pick the
 * earliest of all parsed dates.
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

  const pushDate = (day: number, monthIdx: number) => {
    if (day < 1 || day > 31 || monthIdx < 0) return;
    let year = today.getFullYear();
    const tentative = new Date(year, monthIdx, day);
    if (tentative.getTime() < today.getTime() - 24 * 60 * 60 * 1000) {
      year += 1;
    }
    candidates.push(new Date(year, monthIdx, day));
  };

  // day-month order: "10 Apr", "10 - 14 Apr"
  const dayMonthRe =
    /(\d{1,2})(?:\s*-\s*\d{1,2})?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi;
  let m: RegExpExecArray | null;
  while ((m = dayMonthRe.exec(text)) !== null) {
    pushDate(parseInt(m[1], 10), MONTH_ABBRS.indexOf(m[2].toLowerCase()));
  }

  // month-day order (amazon.com): "Apr 15", "Apr 15 - 17"
  const monthDayRe =
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:\s*-\s*\d{1,2})?/gi;
  while ((m = monthDayRe.exec(text)) !== null) {
    pushDate(parseInt(m[2], 10), MONTH_ABBRS.indexOf(m[1].toLowerCase()));
  }

  if (candidates.length === 0) return null;

  const earliest = candidates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
  const diffMs = earliest.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
