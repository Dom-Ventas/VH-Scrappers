// ─── REVIEW PARSING ───────────────────────────────────────────────────────────
// Flipkart's review page is React-Native-Web: every element carries the same
// generated class (`css-g5y9jx`) with all styling inline, and there are no
// data-attributes or ids. Amazon's selector-per-field approach has nothing to
// bind to here, so reviews are parsed out of the page's innerText instead.
//
// A card renders as a strict, repeating line sequence:
//
//   5.0                                        <- rating, always "N.0"
//   •                                          <- separator, anchors the block
//   Great product                              <- title
//   Review for: Color Blue • Storage 128 GB    <- optional variant line
//   Very good mobile                           <- body (may span lines)
//   Arka Sarkar                                <- author
//   , Kalyani                                  <- location, always comma-led
//   Helpful                                    <- anchors the end of the body
//   Verified Purchase                          <- optional
//   · Today                                    <- relative date, never absolute
//
// This is the one file genuinely coupled to Flipkart's copy, which is why it is
// separated out and kept pure (string in, Review[] out) so it can be tested
// against saved fixtures without a browser.

import { Review } from './types';

const RATING_LINE = /^([1-5])(?:\.\d)?$/;
const BULLET = '•';
const VARIANT_PREFIX = /^Review for:/i;
const DATE_LINE = /^·\s*(.+)$/;
const LOCATION_LINE = /^,\s*(.+)$/;

/** Trailing "...more" / "… more" left when a long body could not be expanded. */
const TRUNCATION = /(\.{3}|…)\s*more$/i;

/**
 * The upvote control ends the body/author region. It renders as "Helpful" with
 * no votes and "Helpful for 12" once anyone has voted, so it must be matched by
 * prefix — an exact match silently loses every review that got upvoted.
 */
const HELPFUL_LINE = /^Helpful\b/i;

function indexOfHelpful(
  lines: string[],
  from: number
): number {

  for (let i = from; i < lines.length; i++) {
    if (HELPFUL_LINE.test(lines[i])) {
      return i;
    }
  }

  return -1;
}

/**
 * Relative age of the review in days ("3 days ago" -> 3). Flipkart never shows
 * an absolute date. Returns null when the text is not recognised.
 */
export function parseRelativeDateDays(
  rawText: string | null | undefined
): number | null {

  if (!rawText) {
    return null;
  }

  const text = rawText.toLowerCase().trim();

  if (text.includes('today') || text.includes('just now')) {
    return 0;
  }

  if (text.includes('yesterday')) {
    return 1;
  }

  const match = text.match(
    /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/
  );

  if (!match) {
    return null;
  }

  const value = parseInt(match[1], 10);

  switch (match[2]) {
    case 'second':
    case 'minute':
    case 'hour':
      return 0;
    case 'day':
      return value;
    case 'week':
      return value * 7;
    case 'month':
      return value * 30;
    case 'year':
      return value * 365;
    default:
      return null;
  }
}

function toLines(
  pageText: string
): string[] {

  return pageText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

/**
 * A block starts at a rating line that is immediately followed by the bullet
 * separator. Requiring both keeps a stray numeric line inside a review body
 * from being mistaken for the start of a new card.
 */
function blockStartIndexes(
  lines: string[]
): number[] {

  const starts: number[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    if (
      RATING_LINE.test(lines[i]) &&
      lines[i + 1] === BULLET
    ) {
      starts.push(i);
    }
  }

  return starts;
}

function parseBlock(
  block: string[]
): Review | null {

  const rating = parseFloat(block[0]);

  if (!Number.isFinite(rating) || rating === 0) {
    return null;
  }

  // block[1] is the bullet separator.
  let cursor = 2;

  let title: string | undefined;

  if (
    cursor < block.length &&
    !VARIANT_PREFIX.test(block[cursor])
  ) {
    title = block[cursor];
    cursor++;
  }

  if (
    cursor < block.length &&
    VARIANT_PREFIX.test(block[cursor])
  ) {
    cursor++;
  }

  // "Helpful" reliably terminates the body/author region. Without it, fall back
  // to the whole remainder so a layout tweak degrades rather than drops the row.
  const helpfulIndex = indexOfHelpful(block, cursor);

  const tail =
    helpfulIndex > cursor
      ? block.slice(cursor, helpfulIndex)
      : block.slice(cursor);

  let location: string | undefined;
  let author: string | undefined;

  if (tail.length) {
    const locationMatch =
      tail[tail.length - 1].match(LOCATION_LINE);

    if (locationMatch) {
      location = locationMatch[1];
      tail.pop();
    }
  }

  if (tail.length) {
    author = tail.pop();
  }

  const text = tail.join(' ').trim();

  let date: string | undefined;

  for (const line of block) {
    const dateMatch = line.match(DATE_LINE);

    if (dateMatch) {
      date = dateMatch[1].trim();
      break;
    }
  }

  return {
    rating,
    title,
    text,
    author,
    location,
    date,
    dateDays: parseRelativeDateDays(date),
    verifiedPurchase: block.includes('Verified Purchase'),
    truncated: TRUNCATION.test(text)
  };
}

/**
 * Parse every review card out of a review page's innerText.
 * Filtering (e.g. to critical reviews) is the caller's job.
 */
export function parseReviewsFromText(
  pageText: string
): Review[] {

  const lines = toLines(pageText);

  const starts = blockStartIndexes(lines);

  const reviews: Review[] = [];

  for (let i = 0; i < starts.length; i++) {

    const start = starts[i];

    // The next card bounds every block but the last, which would otherwise run
    // on into the page footer. "Helpful" plus the two lines that follow it
    // ("Verified Purchase", "· 3 days ago") is the true end of a card, so use
    // whichever boundary comes first.
    const nextStart =
      i + 1 < starts.length
        ? starts[i + 1]
        : lines.length;

    const helpfulIndex =
      indexOfHelpful(lines, start);

    const end =
      helpfulIndex >= 0
        ? Math.min(nextStart, helpfulIndex + 3)
        : nextStart;

    const block = lines.slice(start, end);

    try {

      const review = parseBlock(block);

      if (review) {
        reviews.push(review);
      }

    } catch (err) {

      console.warn(
        `[REVIEW] Failed to parse block ${i + 1}`,
        err
      );
    }
  }

  return reviews;
}
