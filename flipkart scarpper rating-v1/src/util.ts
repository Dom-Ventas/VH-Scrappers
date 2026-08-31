export function sleep(
  ms: number
): Promise<void> {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

export function parseIntSafe(
  text: string | null | undefined
): number {
  if (!text) {
    return 0;
  }

  const cleaned =
    text.replace(/[^\d]/g, '');

  return parseInt(
    cleaned || '0',
    10
  );
}

export function parseFloatSafe(
  text: string | null | undefined
): number {
  if (!text) {
    return 0;
  }

  const match =
    text.match(/[\d.]+/);

  return match
    ? parseFloat(match[0])
    : 0;
}

export function normalizeText(
  text: string | null | undefined
): string {
  if (!text) {
    return '';
  }

  return text
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—'
};

/**
 * Review text comes back from Flipkart's API HTML-escaped ("call &amp; battery",
 * "It&rsquo;s awesome"). Left as-is, the escapes would be stored verbatim and
 * every downstream reader would have to undo them.
 */
export function decodeHtmlEntities(
  text: string | null | undefined
): string {

  if (!text) {
    return '';
  }

  return text
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&([a-z]+);/gi, (match, name) => {
      const value = ENTITIES[name.toLowerCase()];
      return value !== undefined ? value : match;
    });
}

/** YYYY-MM-DD, used to name the local results file. */
export function todayStamp(
  now: Date = new Date()
): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}
