// ─── DELIVERY PROMISE PARSING ─────────────────────────────────────────────────
// Ported unchanged from the Amazon scraper. Flipkart renders the promise as
// "Delivery by 21 Aug, Fri", which the day-first branch below already handles.
//
//   deliveryPromiseDays = promisedDeliveryDate - today
//
// e.g. today = Aug 12, promise = Aug 21  ->  9
//      today = Aug 12, promise = tomorrow ->  1
//      today = Aug 12, promise = today     ->  0
//
// The value is always a whole number of days, or null when the page shows no
// readable delivery promise — so 0 keeps its literal meaning (same-day).
//
// The non-English tables are dead weight for an India-only marketplace, but
// they cost nothing at runtime and keep this file diffable against the Amazon
// version it was copied from.

const MONTHS: Record<string, number> = {
  // English
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,

  // German (accents already stripped: marz = märz)
  januar: 0, februar: 1, marz: 2, mai: 4, juni: 5, juli: 6,
  oktober: 9, dezember: 11, okt: 9, dez: 11,

  // French (aout = août, fevrier = février, decembre = décembre)
  janvier: 0, fevrier: 1, mars: 2, avril: 3, juin: 5, juillet: 6,
  aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,

  // Italian
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, dicembre: 11,

  // Spanish
  enero: 0, febrero: 1, abril: 3, mayo: 4, junio: 5, julio: 6,
  septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,

  // Dutch
  januari: 0, februari: 1, maart: 2, mei: 4, augustus: 7,

  // Swedish
  maj: 4, augusti: 7,

  // Polish (dates use the genitive form: "21 sierpnia")
  stycznia: 0, lutego: 1, marca: 2, kwietnia: 3, maja: 4, czerwca: 5,
  lipca: 6, sierpnia: 7, wrzesnia: 8, pazdziernika: 9, listopada: 10,
  grudnia: 11,

  // Arabic
  'يناير': 0, 'فبراير': 1, 'مارس': 2, 'ابريل': 3, 'مايو': 4, 'يونيو': 5,
  'يوليو': 6, 'اغسطس': 7, 'سبتمبر': 8, 'اكتوبر': 9, 'نوفمبر': 10,
  'ديسمبر': 11
};

const WEEKDAYS: Record<string, number> = {
  // English (0 = Sunday, matching Date#getDay)
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3,
  thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,

  // German
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3,
  donnerstag: 4, freitag: 5, samstag: 6, sonnabend: 6,

  // French
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3,
  jeudi: 4, vendredi: 5, samedi: 6,

  // Italian
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3,
  giovedi: 4, venerdi: 5, sabato: 6,

  // Spanish
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,

  // Dutch
  zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3,
  donderdag: 4, vrijdag: 5, zaterdag: 6,

  // Swedish
  mandag: 1, tisdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lordag: 6,

  // Polish (dates use the accusative form: "w czwartek", "we srode")
  niedziela: 0, niedziele: 0, poniedzialek: 1, wtorek: 2,
  sroda: 3, srode: 3, czwartek: 4, piatek: 5, sobota: 6, sobote: 6,

  // Arabic
  'الاحد': 0, 'الاثنين': 1, 'الثلاثاء': 2, 'الاربعاء': 3,
  'الخميس': 4, 'الجمعة': 5, 'السبت': 6
};

const TODAY_WORDS = [
  'today', 'same-day', 'same day', 'tonight',
  'heute', 'aujourd', 'oggi', 'hoy', 'vandaag',
  'idag', 'i dag', 'dzis', 'dzisiaj', 'اليوم'
];

const TOMORROW_WORDS = [
  'tomorrow', 'morgen', 'demain', 'domani', 'manana',
  'imorgon', 'i morgon', 'jutro', 'غدا', 'غدًا'
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(
  map: Record<string, number>
): string {
  return Object.keys(map)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
}

const MONTH_PATTERN = alternation(MONTHS);
const WEEKDAY_PATTERN = alternation(WEEKDAYS);

// "21 August", "21. August 2025", "21 de agosto", "18 - 22 August" (start of
// the range wins — that is the promise being made). Also matches Flipkart's
// "by 21 Aug, Fri".
const DAY_FIRST = new RegExp(
  `(\\d{1,2})(?:\\s*[-–—]\\s*\\d{1,2})?\\.?\\s*(?:de\\s+|of\\s+)?(${MONTH_PATTERN})(?!\\p{L})(?:\\s+(\\d{4}))?`,
  'iu'
);

// "August 21", "Aug. 21", "August 18 - 22"
const MONTH_FIRST = new RegExp(
  `(${MONTH_PATTERN})(?!\\p{L})\\.?\\s+(\\d{1,2})(?:\\s*[-–—]\\s*\\d{1,2})?(?:,?\\s+(\\d{4}))?`,
  'iu'
);

const WEEKDAY_ONLY = new RegExp(
  `(?<!\\p{L})(${WEEKDAY_PATTERN})(?!\\p{L})`,
  'iu'
);

/**
 * Lowercase, strip accents and collapse whitespace so a single set of keys
 * matches "Août", "août", "AOUT" and "März" / "marz" alike.
 */
export function normalizeForMatch(
  text: string
): string {
  return text
    .normalize('NFD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '') // latin accents: aout <- août, marz <- märz
    .replace(/[ً-ٰ]/g, '') // arabic diacritics + combining hamza
    .replace(/ł/g, 'l') // polish l-stroke has no decomposed form
    .replace(/\s+/g, ' ')
    .trim();
}

function startOfDayMs(
  date: Date
): number {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function diffInDays(
  target: Date,
  now: Date
): number {
  return Math.round(
    (startOfDayMs(target) - startOfDayMs(now)) / 86400000
  );
}

/**
 * The year is omitted, so "3 January" scraped in December means next year.
 * Snap the year so the promise always lands near the future.
 */
function resolveYear(
  day: number,
  month: number,
  year: number | null,
  now: Date
): Date {
  if (year) {
    return new Date(year, month, day);
  }

  let candidate = new Date(
    now.getFullYear(),
    month,
    day
  );

  const diff = diffInDays(candidate, now);

  if (diff < -45) {
    candidate = new Date(now.getFullYear() + 1, month, day);
  } else if (diff > 320) {
    candidate = new Date(now.getFullYear() - 1, month, day);
  }

  return candidate;
}

function matchExplicitDate(
  text: string,
  now: Date
): Date | null {
  const dayFirst = DAY_FIRST.exec(text);
  const monthFirst = MONTH_FIRST.exec(text);

  // Whichever appears first in the text is the primary promise.
  const useDayFirst =
    dayFirst &&
    (!monthFirst || dayFirst.index <= monthFirst.index);

  if (useDayFirst && dayFirst) {
    const day = parseInt(dayFirst[1], 10);
    const month = MONTHS[normalizeForMatch(dayFirst[2])];
    const year = dayFirst[3] ? parseInt(dayFirst[3], 10) : null;

    if (day >= 1 && day <= 31 && month !== undefined) {
      return resolveYear(day, month, year, now);
    }
  }

  if (monthFirst) {
    const month = MONTHS[normalizeForMatch(monthFirst[1])];
    const day = parseInt(monthFirst[2], 10);
    const year = monthFirst[3] ? parseInt(monthFirst[3], 10) : null;

    if (day >= 1 && day <= 31 && month !== undefined) {
      return resolveYear(day, month, year, now);
    }
  }

  return null;
}

function matchWeekday(
  text: string,
  now: Date
): number | null {
  const match = WEEKDAY_ONLY.exec(text);

  if (!match) {
    return null;
  }

  const target = WEEKDAYS[normalizeForMatch(match[1])];

  if (target === undefined) {
    return null;
  }

  // "delivery by Thursday" — the next Thursday on or after today.
  return (target - now.getDay() + 7) % 7;
}

/**
 * Turn a raw delivery string into "days from today".
 * Returns null when the text carries no usable delivery promise.
 */
export function parseDeliveryPromiseDays(
  rawText: string | null | undefined,
  now: Date = new Date()
): number | null {

  if (!rawText) {
    return null;
  }

  const text = normalizeForMatch(rawText);

  if (!text) {
    return null;
  }

  const explicit = matchExplicitDate(text, now);

  if (explicit) {
    const days = diffInDays(explicit, now);

    // A promise slightly in the past means our clock/locale drifted — the
    // realistic promise is "as soon as possible".
    return days < 0 ? 0 : days;
  }

  if (TOMORROW_WORDS.some(word => text.includes(word))) {
    return 1;
  }

  if (TODAY_WORDS.some(word => text.includes(word))) {
    return 0;
  }

  const weekday = matchWeekday(text, now);

  if (weekday !== null) {
    return weekday;
  }

  return null;
}
