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

/**
 * A failure that will never succeed on a retry — an unknown SKU, a delisted
 * product. retry() rethrows these immediately instead of burning attempts (and
 * minutes) on a result that cannot change.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}
