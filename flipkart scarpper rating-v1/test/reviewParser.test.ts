// Fixture-based check for the one module genuinely coupled to Flipkart's copy.
// The fixture is the verbatim innerText of a real review page, footer and
// rating histogram included, so the parser is exercised against exactly what it
// sees in production.
//
//   npx ts-node test/reviewParser.test.ts

import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

import {
  parseReviewsFromText,
  parseRelativeDateDays
} from '../src/reviewParser';

const fixture = fs.readFileSync(
  path.join(
    __dirname,
    'fixtures',
    'review-page-mobgtagptb3vs24w-p2.txt'
  ),
  'utf8'
);

const reviews = parseReviewsFromText(fixture);

let failures = 0;

function check(
  name: string,
  fn: () => void
): void {

  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err}`);
  }
}

console.log('\nreviewParser');

check('finds every review card, and nothing from the footer', () => {
  assert.strictEqual(reviews.length, 10);
});

check('the rating histogram does not produce phantom reviews', () => {
  // "1 ★ 10,999" would parse as a 1-star review if the bullet anchor failed.
  assert.ok(
    reviews.every(r => r.author && r.author.length > 0),
    'every parsed card should have an author'
  );
});

check('parses a full card', () => {
  const first = reviews[0];

  assert.strictEqual(first.rating, 5);
  assert.strictEqual(first.title, 'Terrific purchase');
  assert.strictEqual(first.text, 'Good Mobile');
  assert.strictEqual(first.author, 'Priyojit Mondal');
  assert.strictEqual(first.location, 'Murshidabad District');
  assert.strictEqual(first.date, '1 day ago');
  assert.strictEqual(first.dateDays, 1);
  assert.strictEqual(first.verifiedPurchase, true);
  assert.strictEqual(first.truncated, false);
});

check('drops the "Review for: ..." variant line from the body', () => {
  assert.ok(
    reviews.every(r => !/Review for:/i.test(r.text || '')),
    'variant line leaked into a body'
  );
});

check('handles "Helpful for N" on upvoted cards', () => {
  // Satyabrat Jena's card renders "Helpful for 1" rather than "Helpful".
  const upvoted = reviews.find(r => r.author === 'Satyabrat Jena');

  assert.ok(upvoted, 'upvoted review was dropped entirely');
  assert.strictEqual(upvoted!.text, 'Awesome device');
  assert.strictEqual(upvoted!.location, 'Hyderabad');
});

check('the last card stops before the page footer', () => {
  const last = reviews[reviews.length - 1];

  assert.strictEqual(last.author, 'Sephali Mishra');
  assert.ok(
    !/ABOUT|Flipkart Internet|Contact Us/.test(last.text || ''),
    `footer leaked into the last body: "${last.text}"`
  );
});

check('critical filter selects exactly the 1-2 star cards', () => {
  const critical = reviews.filter(r => r.rating > 0 && r.rating <= 2);

  assert.strictEqual(critical.length, 2);
  assert.deepStrictEqual(
    critical.map(r => r.author).sort(),
    ['Pawan Khated', 'Rishabh Bhardwaj']
  );
  assert.deepStrictEqual(
    critical.map(r => r.rating).sort(),
    [1, 2]
  );
});

console.log('\nparseRelativeDateDays');

check('resolves the relative dates Flipkart actually renders', () => {
  assert.strictEqual(parseRelativeDateDays('Today'), 0);
  assert.strictEqual(parseRelativeDateDays('1 day ago'), 1);
  assert.strictEqual(parseRelativeDateDays('3 days ago'), 3);
  assert.strictEqual(parseRelativeDateDays('2 months ago'), 60);
  assert.strictEqual(parseRelativeDateDays('1 year ago'), 365);
  assert.strictEqual(parseRelativeDateDays('5 hours ago'), 0);
  assert.strictEqual(parseRelativeDateDays('sometime'), null);
  assert.strictEqual(parseRelativeDateDays(undefined), null);
});

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) failed.\n`
);

process.exit(failures === 0 ? 0 : 1);
