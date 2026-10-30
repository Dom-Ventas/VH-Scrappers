import { test, expect } from '@playwright/test';
import { parseEbayPrice, parseRating, pickDelivery } from '../src/util';
import { criticalExpected, toReviews } from '../src/extractors';
import { buildListingUrl, buildReviewsUrl } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';

// Wednesday 14 Oct 2026, mid-day so a timezone shift cannot move the date.
const NOW = new Date(2026, 9, 14, 12, 0, 0);

test.describe('pickDelivery — the listing\'s Delivery / Shipping row', () => {
  const cases: Array<[string, number | null, string | null]> = [
    ['Estimated between Fri, Oct 16 and Tue, Oct 20 to 10001', 2, 'Estimated between Fri, Oct 16 and Tue, Oct 20 to 10001'],
    ['Free 2-4 day delivery Get it between Fri, Oct 16 and Mon, Oct 19 to 10001. See details for shipping', 2,
      'Get it between Fri, Oct 16 and Mon, Oct 19 to 10001.'],
    ['Get it by Thu, Oct 15', 1, 'Get it by Thu, Oct 15'],
    // the handling-time sentence ("innerhalb von 1 Tag") is not a delivery promise
    ['Lieferung zwischen Di, 10. Nov und Fr, 20. Nov nach 560010 bei heutigem Zahlungseingang Verkäufer verschickt innerhalb von 1 Tag nach Zahlungseingang.',
      27, 'Lieferung zwischen Di, 10. Nov und Fr, 20. Nov nach 560010 bei heutigem Zahlungseingang'],
    ['Estimated between Sat, Oct 17 and Fri, Oct 23 to 10001 Seller ships within 1 day after receiving cleared payment.', 3,
      'Estimated between Sat, Oct 17 and Fri, Oct 23 to 10001'],
    ['Varies', null, 'Varies'],
  ];
  for (const [text, days, kept] of cases) {
    test(`"${text.slice(0, 60)}…" -> ${days}`, () => {
      expect(pickDelivery(text, NOW)).toEqual({ deliveryDays: days, deliveryText: kept });
    });
  }

  test('empty text', () => {
    expect(pickDelivery('', NOW)).toEqual({ deliveryText: null, deliveryDays: null });
    expect(pickDelivery(null, NOW)).toEqual({ deliveryText: null, deliveryDays: null });
  });
});

test('parseRating reads English and German', () => {
  expect(parseRating('4.5 out of 5 stars')).toBe(4.5);
  expect(parseRating('4,7 von 5 Sternen')).toBe(4.7);
  expect(parseRating('72 product ratings')).toBeNull();
});

test('parseEbayPrice reads listing prices', () => {
  expect(parseEbayPrice('US $16.34')).toBe(16.34);
  expect(parseEbayPrice('EUR 135,73', true)).toBe(135.73);
  expect(parseEbayPrice('EUR 1.234,56', true)).toBe(1234.56);
});

test('toReviews maps raw reviews and drops ones without a whole 1-5 rating', () => {
  const out = toReviews([
    { id: '10000000335385089', rating: 1, title: ' One of the earbuds ', text: 'Half the sound', author: 'vcram_95', date: 'Jul 14, 2026', verified: true, pinned: false },
    { id: null, rating: null, title: 'x', text: 'y', author: null, date: null, verified: false, pinned: false },
    { id: '2', rating: 3.5, title: null, text: null, author: null, date: null, verified: false, pinned: true },
  ]);
  expect(out).toEqual([
    { reviewId: '10000000335385089', rating: 1, title: 'One of the earbuds', text: 'Half the sound', author: 'vcram_95', date: 'Jul 14, 2026', verifiedPurchase: true },
  ]);
});

test('criticalExpected sums the 1- and 2-star histogram bars', () => {
  expect(criticalExpected({ '1': 69, '2': 13, '3': 22, '4': 44, '5': 411 })).toBe(82);
  expect(criticalExpected({ '1': 0, '2': 0, '5': 3 })).toBe(0);
  expect(criticalExpected({})).toBeNull();
});

test('URLs: listing by item number, reviews by epid sorted lowest first', () => {
  const us = resolveMarketplace('EBUS');
  expect(buildListingUrl(us, ' 265983500898 ')).toBe('https://www.ebay.com/itm/265983500898');
  expect(buildReviewsUrl(us, '17054784938', '265983500898', 2)).toBe(
    'https://www.ebay.com/urw/product-reviews/17054784938?_itm=265983500898&sort=%2Brating&pgn=2',
  );
  expect(buildListingUrl(resolveMarketplace('EBDE'), '278359701353')).toBe('https://www.ebay.de/itm/278359701353');
});
