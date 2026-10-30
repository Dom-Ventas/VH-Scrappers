export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A failure that will never succeed on a retry — an unknown wpid, a delisted
 * product. retry() rethrows these immediately instead of burning attempts (and
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
 * Read a rating out of Walmart's screen-reader text.
 *
 *   "4.3 out of 5 stars (4.3) 86K ratings" -> 4.3
 *   "(No ratings yet)"                     -> null
 */
export function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d(?:\.\d+)?)\s*out of\s*5\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

/**
 * Read a count that Walmart may have compacted: "86K ratings" -> 86000,
 * "1.2M" -> 1200000, "4,502" -> 4502. Only an approximation when compacted —
 * the product data block carries the exact number and is read first.
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

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const MONTH_ABBRS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function monthIndex(token: string): number {
  return MONTH_ABBRS.indexOf(token.toLowerCase().slice(0, 3));
}

export function startOfDay(d: Date): Date {
  const c = new Date(d.getTime());
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Parse Walmart's delivery wording into days from `now`. The same parser the
 * ads scraper uses on the search grid, plus the bare badge forms the product
 * data carries ("Tomorrow", "Today", "3+ days", "Thu, Oct 15").
 *
 *   "Arrives tomorrow" / "Tomorrow"        -> 1
 *   "Today" / "As soon as 2 hours"         -> 0
 *   "Thu, Oct 15" / "arrives Oct 14 - 16"  -> N
 *   "in 3+ days" / "3+ days"               -> 3
 *   "arrives Fri"                          -> next such weekday
 */
export function parseDeliveryDays(text: string | null | undefined, now: Date = new Date()): number | null {
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
  if (/\b(?:as soon as|in|within)\s+\d{1,3}\s*(?:min|mins|minute|minutes|hour|hours|hr|hrs)\b/i.test(text)) {
    pushOffset(0);
  }

  const pushDate = (day: number, monthIdx: number) => {
    if (day < 1 || day > 31 || monthIdx < 0 || monthIdx > 11) return;
    let year = today.getFullYear();
    const tentative = new Date(year, monthIdx, day);
    if (tentative.getTime() < today.getTime() - 24 * 60 * 60 * 1000) year += 1;
    candidates.push(new Date(year, monthIdx, day));
  };

  let m: RegExpExecArray | null;
  const monthDayRe = new RegExp(`\\b(${MONTHS})[a-z]*\\.?,?\\s+(\\d{1,2})(?!\\d)`, 'gi');
  while ((m = monthDayRe.exec(text)) !== null) pushDate(parseInt(m[2], 10), monthIndex(m[1]));
  const dayMonthRe = new RegExp(`(?<![\\d/])(\\d{1,2})(?:\\s*[-–]\\s*\\d{1,2})?\\s+(${MONTHS})[a-z]*\\b`, 'gi');
  while ((m = dayMonthRe.exec(text)) !== null) pushDate(parseInt(m[1], 10), monthIndex(m[2]));
  const numericRe = /(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/g;
  while ((m = numericRe.exec(text)) !== null) pushDate(parseInt(m[2], 10), parseInt(m[1], 10) - 1);
  // "in 3+ days", "3+ days", "2-4 business days"
  const relativeRe = /(?:\b(?:in|within)\s+)?(?<![\d.])(\d{1,2})\s*\+?(?:\s*[-–]\s*\d{1,2})?\s*(?:business\s+)?days?\b/gi;
  while ((m = relativeRe.exec(text)) !== null) {
    const days = parseInt(m[1], 10);
    if (days >= 0 && days <= 90) pushOffset(days);
  }

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
  return Math.round((earliest.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Whole calendar days from today to an ISO date, read by the calendar date AS
 * WRITTEN ("2026-10-14T21:59:00.000Z" -> Oct 14) rather than by converting the
 * instant to the laptop's zone. The date is a US store's promise; a laptop in
 * another time zone must not shift it by a day.
 */
export function daysUntilIso(iso: string | null | undefined, now: Date = new Date()): number | null {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.round((target.getTime() - startOfDay(now).getTime()) / (1000 * 60 * 60 * 24));
  return days >= 0 && days <= 365 ? days : null;
}

/** The slice of a Walmart `fulfillmentOptions[]` entry the promise is read from. */
export interface FulfillmentOption {
  type?: string;
  availabilityStatus?: string;
  speedDetails?: {
    fulfillmentBadge?: string | null;
    slaDayEnum?: string | null;
    deliveryDate?: string | null;
    storeDeliveryDate?: string | null;
    slaInMins?: number | null;
  } | null;
}

export interface DeliveryPick {
  deliveryDays: number | null;
  deliveryText: string | null;
}

/**
 * Pick the delivery promise out of the product's fulfillment options.
 *
 * Walmart lists up to three ways to get an item: SHIPPING (parcel), DELIVERY
 * (same-day from a store) and PICKUP. Pickup is not delivery and is ignored;
 * an option that is out of stock is ignored; among the rest the EARLIEST wins,
 * so an item with same-day delivery and next-day shipping is a 0 — the same
 * rule the ads scraper applies to the search grid badges.
 *
 * Per option the sources are tried in order: the badge text Walmart prints
 * ("Tomorrow", "Thu, Oct 15", "3+ days"), the `slaDayEnum` (TODAY / TOMORROW),
 * an express SLA in minutes (= today), the ISO delivery date, and finally a
 * bucket enum such as FROM_2_TO_7_DAYS (its lower bound).
 */
export function pickDeliveryFromOptions(
  options: readonly FulfillmentOption[] | null | undefined,
  now: Date = new Date(),
): DeliveryPick {
  let best: DeliveryPick = { deliveryDays: null, deliveryText: null };
  for (const opt of options || []) {
    const type = (opt.type || '').toUpperCase();
    if (!/SHIPPING|DELIVERY/.test(type)) continue;
    const status = (opt.availabilityStatus || '').toUpperCase();
    if (status && /OUT_OF_STOCK|NOT_AVAILABLE|UNAVAILABLE/.test(status)) continue;
    const sd = opt.speedDetails || {};
    const badge = normalizeText(sd.fulfillmentBadge);
    const sla = (sd.slaDayEnum || '').toUpperCase();

    let days: number | null = parseDeliveryDays(badge, now);
    if (days === null && sla === 'TODAY') days = 0;
    if (days === null && sla === 'TOMORROW') days = 1;
    if (days === null && typeof sd.slaInMins === 'number' && sd.slaInMins > 0) days = 0;
    if (days === null) days = daysUntilIso(sd.deliveryDate || sd.storeDeliveryDate, now);
    // Coarse bucket enums ("FROM_2_TO_7_DAYS", "FROM_3_DAYS") are the last
    // resort: the ISO date above is the actual promise when Walmart has one.
    if (days === null) {
      const bucket = sla.match(/^FROM_(\d{1,2})(?:_TO_\d{1,2})?_DAYS?$/);
      if (bucket) days = parseInt(bucket[1], 10);
    }

    const text = `${type}: ${badge || sla || sd.deliveryDate || '?'}`;
    if (best.deliveryText === null) best = { deliveryDays: days, deliveryText: text };
    if (days !== null && (best.deliveryDays === null || days < best.deliveryDays)) {
      best = { deliveryDays: days, deliveryText: text };
    }
  }
  return best;
}

/**
 * The same choice from the product page's visible fulfillment tiles
 * ("Shipping Arrives tomorrow Free", "Delivery As soon as 2 hours",
 * "Pickup Tomorrow"): delivery/shipping only, earliest wins.
 */
export function pickDeliveryFromTiles(lines: readonly string[], now: Date = new Date()): DeliveryPick {
  let best: DeliveryPick = { deliveryDays: null, deliveryText: null };
  for (const raw of lines) {
    const line = normalizeText(raw);
    if (!line || /\bpick\s*-?\s*up\b/i.test(line)) continue;
    if (!/\b(?:arriv|deliver|shipping|ships)/i.test(line)) continue;
    const days = parseDeliveryDays(line, now);
    if (best.deliveryText === null) best = { deliveryDays: days, deliveryText: line };
    if (days !== null && (best.deliveryDays === null || days < best.deliveryDays)) {
      best = { deliveryDays: days, deliveryText: line };
    }
  }
  return best;
}
