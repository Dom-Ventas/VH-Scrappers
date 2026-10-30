import { test, expect } from '@playwright/test';
import {
  daysUntilIso,
  parseCompactCount,
  parseDeliveryDays,
  parseRating,
  pickDeliveryFromOptions,
  pickDeliveryFromTiles,
} from '../src/util';
import { criticalExpected, isRealProduct, toReviews } from '../src/extractors';
import { buildProductUrl, buildReviewsUrl } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';

// Tuesday 13 Oct 2026, mid-day so a timezone shift cannot move the date.
const NOW = new Date(2026, 9, 13, 12, 0, 0);
const WM = resolveMarketplace('WMUS');

test.describe('parseDeliveryDays — product page shapes', () => {
  const cases: Array<[string, number | null]> = [
    ['Tomorrow', 1],
    ['Today', 0],
    ['Thu, Oct 15', 2],
    ['3+ days', 3],
    ['Shipping Arrives tomorrow Free', 1],
    ['Delivery As soon as 2 hours', 0],
    ['Ships to Sacramento, 95829 Arrives by Tomorrow', 1],
    ['Arrives by Fri, Oct 16', 3],
    ['2-4 business days', 2],
    ['Free', null],
    ['', null],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" -> ${expected}`, () => {
      expect(parseDeliveryDays(text, NOW)).toBe(expected);
    });
  }
});

test('daysUntilIso counts calendar days by the date as written', () => {
  expect(daysUntilIso('2026-10-14T21:59:00.000Z', NOW)).toBe(1);
  expect(daysUntilIso('2026-10-13T06:00:00.000-07:00', NOW)).toBe(0);
  expect(daysUntilIso('2026-10-13T21:59:00.000Z', NOW)).toBe(0);
  expect(daysUntilIso('2026-10-20T00:00:00.000Z', NOW)).toBe(7);
  expect(daysUntilIso('garbage', NOW)).toBeNull();
  expect(daysUntilIso(null, NOW)).toBeNull();
});

test.describe('pickDeliveryFromOptions', () => {
  const shipping = (badge: string | null, sla: string | null, date: string | null) => ({
    type: 'SHIPPING',
    availabilityStatus: 'IN_STOCK',
    speedDetails: { fulfillmentBadge: badge, slaDayEnum: sla, deliveryDate: date, slaInMins: null },
  });

  test('earliest of shipping and same-day delivery wins; pickup is ignored', () => {
    const pick = pickDeliveryFromOptions(
      [
        shipping('Tomorrow', 'TOMORROW', '2026-10-13T21:59:00.000Z'),
        { type: 'PICKUP', availabilityStatus: 'IN_STOCK', speedDetails: { fulfillmentBadge: 'Today', slaDayEnum: 'TODAY' } },
        { type: 'DELIVERY', availabilityStatus: 'IN_STOCK', speedDetails: { fulfillmentBadge: 'Today', slaDayEnum: 'TOMORROW', slaInMins: 180 } },
      ],
      NOW,
    );
    expect(pick).toEqual({ deliveryDays: 0, deliveryText: 'DELIVERY: Today' });
  });

  test('badge text beats the sla enum and the ISO date', () => {
    expect(pickDeliveryFromOptions([shipping('Thu, Oct 15', 'TOMORROW', '2026-10-13T21:59:00.000Z')], NOW).deliveryDays).toBe(2);
  });

  test('falls back to the sla enum, then the ISO date, then a bucket enum', () => {
    expect(pickDeliveryFromOptions([shipping(null, 'TOMORROW', null)], NOW).deliveryDays).toBe(1);
    expect(pickDeliveryFromOptions([shipping(null, null, '2026-10-17T12:00:00.000Z')], NOW).deliveryDays).toBe(4);
    // The ISO date is the real promise; the bucket only counts when there is none.
    expect(pickDeliveryFromOptions([shipping(null, 'FROM_2_TO_7_DAYS', '2026-10-14T21:59:00.000Z')], NOW).deliveryDays).toBe(1);
    expect(pickDeliveryFromOptions([shipping(null, 'FROM_2_TO_7_DAYS', null)], NOW).deliveryDays).toBe(2);
    expect(pickDeliveryFromOptions([shipping(null, 'FROM_3_DAYS', null)], NOW).deliveryDays).toBe(3);
  });

  test('out-of-stock options and pickup-only products yield null', () => {
    expect(pickDeliveryFromOptions([{ ...shipping('Tomorrow', 'TOMORROW', null), availabilityStatus: 'OUT_OF_STOCK' }], NOW)).toEqual({
      deliveryDays: null,
      deliveryText: null,
    });
    expect(pickDeliveryFromOptions([{ type: 'PICKUP', speedDetails: { fulfillmentBadge: 'Today' } }], NOW).deliveryDays).toBeNull();
    expect(pickDeliveryFromOptions(null, NOW).deliveryDays).toBeNull();
  });
});

test('pickDeliveryFromTiles reads the visible tiles the same way', () => {
  expect(
    pickDeliveryFromTiles(['Shipping Arrives tomorrow Free', 'Delivery As soon as 2 hours', 'Pickup Tomorrow Free'], NOW),
  ).toEqual({ deliveryDays: 0, deliveryText: 'Delivery As soon as 2 hours' });
  expect(pickDeliveryFromTiles(['Pickup Tomorrow Free'], NOW).deliveryDays).toBeNull();
});

test('parseRating and parseCompactCount read the ratings widget', () => {
  expect(parseRating('4.3 out of 5 stars (4.3) 86K ratings')).toBe(4.3);
  expect(parseRating('(No ratings yet)')).toBeNull();
  expect(parseCompactCount('86K ratings')).toBe(86000);
  expect(parseCompactCount('4,502')).toBe(4502);
  expect(parseCompactCount('1.2M')).toBe(1200000);
  expect(parseCompactCount('')).toBeNull();
});

test('toReviews maps Walmart review objects and drops unrated ones', () => {
  const out = toReviews({
    customerReviews: [
      {
        reviewId: '443227041',
        rating: 1,
        reviewTitle: '  Broke  ',
        reviewText: 'Day\n two',
        reviewSubmissionTime: '3/12/2026',
        userNickname: 'Debra',
        badges: [{ id: 'VerifiedPurchaser' }],
      },
      { rating: 2, reviewTitle: null, reviewText: 'meh', userNickname: 'x', badges: [] },
      { rating: null, reviewText: 'unrated' },
    ],
  });
  expect(out).toEqual([
    { reviewId: '443227041', rating: 1, title: 'Broke', text: 'Day two', author: 'Debra', date: '3/12/2026', verifiedPurchase: true },
    { reviewId: undefined, rating: 2, title: undefined, text: 'meh', author: 'x', date: undefined, verifiedPurchase: false },
  ]);
});

test('criticalExpected prefers the with-text counts', () => {
  expect(criticalExpected({ reviewsWithTextRatingOneCount: 500, reviewsWithTextRatingTwoCount: 100, ratingValueOneCount: 8505, ratingValueTwoCount: 2721 })).toBe(600);
  expect(criticalExpected({ ratingValueOneCount: 8505, ratingValueTwoCount: 2721 })).toBe(11226);
  expect(criticalExpected({})).toBeNull();
  expect(criticalExpected(null)).toBeNull();
});

test('isRealProduct rejects the empty product of the not-found page', () => {
  expect(isRealProduct({ usItemId: '11381374703', name: 'Apple AirPods 4' })).toBe(true);
  expect(isRealProduct({ id: null, usItemId: null, name: null })).toBe(false);
  expect(isRealProduct(null)).toBe(false);
});

test('URLs: product by wpid, reviews by numeric item id sorted ascending', () => {
  expect(buildProductUrl(WM, ' 243ESPUGUSOJ ')).toBe('https://www.walmart.com/ip/243ESPUGUSOJ');
  expect(buildReviewsUrl(WM, '11381374703', 3)).toBe(
    'https://www.walmart.com/reviews/product/11381374703?sort=rating-asc&page=3',
  );
});
