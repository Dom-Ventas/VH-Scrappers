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
 * Read the star rating out of Walmart's screen-reader text.
 *
 *   "4.6 out of 5 stars"               -> 4.6
 *   "4.3 out of 5 Stars. 86071 reviews" -> 4.3
 *   "4502"                              -> null   (a review count, not a rating)
 *
 * Only the "<n> out of 5" shape is trusted; a bare number is accepted only
 * when it is already in range, so a review count can never be mistaken for a
 * rating when the hashed class names rotate and a selector drifts.
 */
export function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d(?:\.\d+)?)\s*out of\s*5\b/i);
  const n = m ? parseFloat(m[1]) : /^\s*\d(?:\.\d+)?\s*$/.test(text) ? parseFloat(text) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return n;
}

/**
 * Read the review count. Walmart prints it as a bare number next to the stars
 * ("4502", with a `data-value` attribute holding the same), and repeats it in
 * the screen-reader line ("4.3 out of 5 Stars. 86071 reviews").
 *
 *   "4502"                              -> 4502
 *   "1,234"                             -> 1234
 *   "86071 reviews"                     -> 86071
 *   "4.3 out of 5 Stars. 86071 reviews" -> 86071  (not 4, not 3)
 *   "4.3 out of 5 stars"                -> null   (a rating line, no count)
 */
export function parseReviewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const labelled = text.match(/(\d[\d,]*)\s*reviews?\b/i);
  if (labelled) return parseIntSafe(labelled[1]);
  if (/out of\s*5/i.test(text)) return null;
  const first = text.match(/\d[\d,]*/);
  return first ? parseIntSafe(first[0]) : null;
}

/**
 * Read the selling price out of Walmart's screen-reader price line, which is
 * the one place the amount is printed as a plain "$363.00" (the visible price
 * is split into "$", "363" and "00" spans, whose joined text reads "$36300").
 *
 *   "Price $363.00 Options from $159.99"                -> 363
 *   "Price Now $20.99 Was $159.95 Options from $14.00"  -> 20.99  (Now = current)
 *   "current price $359.00"                             -> 359
 *   "Price Options from $14.00"                         -> 14     (a from-price, like Otto's "ab")
 *   "Low stock"                                         -> null
 *
 * "Was $159.95" is the struck-through pre-reduction price and must never win;
 * it only ever follows "Now", which is matched first.
 */
export function parseWalmartPrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const amount = /(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/.source;
  const pick = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m) return null;
    const n = parseFloat(`${m[1].replace(/,/g, '')}.${m[2] || '0'}`);
    return Number.isFinite(n) ? n : null;
  };
  return (
    pick(new RegExp(`\\bnow\\s*\\$\\s*${amount}`, 'i')) ??
    pick(new RegExp(`\\bprice\\s*\\$\\s*${amount}`, 'i')) ??
    pick(new RegExp(`\\$\\s*${amount}`))
  );
}

/**
 * Format a price the way the backend's parse_price() reads unambiguously:
 * "<ISO currency> <amount with a dot decimal>", e.g. "USD 363.00". Same shape
 * as the noon ("AED 165.30") and Otto ("EUR 1299.00") scrappers.
 */
export function formatPrice(amount: number | null, currency: string): string | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  return `${currency} ${amount.toFixed(2)}`;
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const MONTH_ABBRS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function monthIndex(token: string): number {
  return MONTH_ABBRS.indexOf(token.toLowerCase().slice(0, 3));
}

function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Parse Walmart's delivery text and return the number of days from `now` to
 * the earliest promised delivery date.
 *
 * Handles the shapes Walmart prints on the search grid badges:
 *   "Delivery as soon as 13 mins"          -> 0   (local express; sub-day)
 *   "Delivery as soon as 1 hour"           -> 0
 *   "Arrives today"                        -> 0
 *   "Free shipping, arrives tomorrow"      -> 1
 *   "Shipping, arrives Wed, Oct 14"        -> N   (weekday prefix ignored)
 *   "Shipping, arrives Oct 14 - Oct 16"    -> N   (earliest of the range)
 *   "Shipping, arrives in 2+ days"         -> 2   ("2+" = at least two)
 *   "Free shipping, arrives in 3-5 days"   -> 3   (start of range)
 *   "arrives Fri"                          -> N   (next such weekday, 1..7)
 *
 * When several dates appear in one line the earliest wins. "Pickup" lines are
 * NOT excluded here — that is pickDelivery()'s job — so this stays a pure
 * date parser. Returns null if no parseable date is found.
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

  if (/\btoday\b/i.test(text)) pushOffset(0);
  if (/\btomorrow\b/i.test(text)) pushOffset(1);

  // Sub-day promises ("as soon as 13 mins", "within 2 hours") land today.
  if (/\b(?:as soon as|in|within)\s+\d{1,3}\s*(?:min|mins|minute|minutes|hour|hours|hr|hrs)\b/i.test(text)) {
    pushOffset(0);
  }

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

  // month-day order (Walmart's form): "Oct 14", "Wed, Oct 14", "Oct 14 - 16".
  // (?!\d) keeps a trailing year ("Oct 14, 2026") from being read as day 20.
  const monthDayRe = new RegExp(`\\b(${MONTHS})[a-z]*\\.?,?\\s+(\\d{1,2})(?!\\d)(?:\\s*[-–]\\s*(\\d{1,2})(?!\\d))?`, 'gi');
  while ((m = monthDayRe.exec(text)) !== null) {
    pushDate(parseInt(m[2], 10), monthIndex(m[1]));
  }

  // day-month order: "14 Oct", "14 - 16 Oct"
  const dayMonthRe = new RegExp(`(?<![\\d/])(\\d{1,2})(?:\\s*[-–]\\s*\\d{1,2})?\\s+(${MONTHS})[a-z]*\\b`, 'gi');
  while ((m = dayMonthRe.exec(text)) !== null) {
    pushDate(parseInt(m[1], 10), monthIndex(m[2]));
  }

  // numeric US date: "10/14"
  const numericRe = /(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/g;
  while ((m = numericRe.exec(text)) !== null) {
    pushDate(parseInt(m[2], 10), parseInt(m[1], 10) - 1);
  }

  // relative form: "in 2 days", "in 2+ days", "in 3-5 days", "within 4 business days"
  const relativeRe = /\b(?:in|within)\s+(\d{1,2})\s*\+?(?:\s*[-–]\s*\d{1,2})?\s*(?:business\s+)?days?\b/gi;
  while ((m = relativeRe.exec(text)) !== null) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 90) pushOffset(days);
  }

  // weekday only ("arrives Fri"): the next such day. A weekday that is today
  // would have said "today", so a match on today's name means next week.
  if (candidates.length === 0) {
    const wd = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i);
    if (wd) {
      const target = WEEKDAYS.indexOf(wd[1].toLowerCase());
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
 * Choose the delivery promise from a tile's badge lines.
 *
 * A Walmart tile carries several badges, and they are not equally useful:
 *   "Save with [Walmart+]"             — a membership badge, no date
 *   "Delivery as soon as 13 mins"      — local express delivery (sub-day)
 *   "Free shipping, arrives tomorrow"  — the shipping promise
 *   "Free pickup as soon as tomorrow"  — store PICKUP, not delivery
 *   "Low stock" / "Best seller" / …    — merchandising flags
 *
 * Only lines that talk about delivery or shipping are considered; pickup lines
 * are dropped because the slot means "days until it reaches the customer".
 * Among the rest the EARLIEST date wins (so express beats ground shipping on a
 * tile that offers both), and `deliveryText` is the line that produced it. A
 * delivery line that carries no date ("Free shipping") is still returned as
 * text with null days, so an audit can tell "no promise" from "unparsed".
 */
export function pickDelivery(lines: readonly string[], now: Date = new Date()): DeliveryPick {
  const candidates = lines
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && /\b(?:arriv|deliver|shipping|ships|get it)/i.test(l) && !/\bpick\s*-?\s*up\b/i.test(l));
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
