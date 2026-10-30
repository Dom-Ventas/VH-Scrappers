import { test, expect } from '@playwright/test';
import {
  formatPrice,
  parseDeliveryDays,
  parseEbayPrice,
  parseRating,
  parseReviewCount,
  pickDelivery,
} from '../src/util';
import { buildSearchUrl } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';
import { itemIdFromHref } from '../src/extractors';

// Wednesday 14 Oct 2026, mid-day so a timezone shift cannot move the date.
const NOW = new Date(2026, 9, 14, 12, 0, 0);

test.describe('parseDeliveryDays — eBay delivery rows', () => {
  const cases: Array<[string, number | null]> = [
    ['Free delivery in 2-3 days', 2],
    ['Free delivery in 2-4 days', 2],
    ['Delivery in 4 days', 4],
    ['Get it today', 0],
    ['Get it tomorrow', 1],
    ['Get it by Fri, Oct 16', 2],
    ['Est. delivery Thu, Oct 15 - Tue, Oct 20', 1],
    ['Free delivery by Sat, 17 Oct', 3], // ebay.co.uk day-month
    ['Lieferung bis Do, 15. Okt', 1],
    ['Lieferung Fr, 16. Okt - Di, 20. Okt', 2],
    ['Kostenlose Lieferung in 2-4 Tagen', 2],
    ['Lieferung bis 16.10.', 2],
    ['Get it by Mon, Jan 4', 82], // already past this year -> next year
    ['Get it by Fri', 2],
    ['Get it by Wed', 7], // today's weekday means next week
    ['Free delivery', null],
    ['+$20.00 delivery', null],
    ['+EUR 26,37 Lieferung', null],
    ['Kostenloser internationaler Versand', null],
    ['', null],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" -> ${expected}`, () => {
      expect(parseDeliveryDays(text, NOW)).toBe(expected);
    });
  }

  test('a trailing year is not read as a day', () => {
    expect(parseDeliveryDays('Get it by Oct 16, 2026', NOW)).toBe(2);
  });

  test('null / undefined', () => {
    expect(parseDeliveryDays(null, NOW)).toBeNull();
    expect(parseDeliveryDays(undefined, NOW)).toBeNull();
  });
});

test.describe('pickDelivery — which attribute row wins', () => {
  test('the dated delivery row wins over cost and merchandising rows', () => {
    const pick = pickDelivery(
      ['$67.95', 'Buy It Now', 'Free delivery in 2-3 days', 'Located in United States', 'Free returns', '315+ sold'],
      NOW,
    );
    expect(pick).toEqual({ deliveryText: 'Free delivery in 2-3 days', deliveryDays: 2 });
  });

  test('an undated delivery row is kept as text with null days', () => {
    expect(pickDelivery(['$15.49', 'Buy It Now', 'Free delivery', 'Located in United States'], NOW)).toEqual({
      deliveryText: 'Free delivery',
      deliveryDays: null,
    });
  });

  test('returns rows are never a delivery promise', () => {
    expect(pickDelivery(['Free returns', 'Kostenloser Rückversand'], NOW)).toEqual({
      deliveryText: null,
      deliveryDays: null,
    });
  });

  test('earliest of several dated rows wins', () => {
    const pick = pickDelivery(['Delivery in 5 days', 'Get it by Fri, Oct 16'], NOW);
    expect(pick.deliveryDays).toBe(2);
  });
});

test.describe('parseEbayPrice', () => {
  const dot: Array<[string, number | null]> = [
    ['$15.49', 15.49],
    ['$1,234.56', 1234.56],
    ['$8.89 to $10.49', 8.89],
    ['£37.09', 37.09],
    ['AU $12.00', 12],
    ['$20', 20],
    ['Buy It Now', null],
  ];
  for (const [text, expected] of dot) {
    test(`"${text}" -> ${expected}`, () => expect(parseEbayPrice(text)).toBe(expected));
  }
  const comma: Array<[string, number | null]> = [
    ['EUR 16,57', 16.57],
    ['EUR 1.234,56', 1234.56],
    ['EUR 16,57 bis EUR 32,60', 16.57],
    ['EUR 8', 8],
  ];
  for (const [text, expected] of comma) {
    test(`decimal comma "${text}" -> ${expected}`, () => expect(parseEbayPrice(text, true)).toBe(expected));
  }
});

test('formatPrice', () => {
  expect(formatPrice(15.49, 'USD')).toBe('USD 15.49');
  expect(formatPrice(8, 'EUR')).toBe('EUR 8.00');
  expect(formatPrice(null, 'USD')).toBeNull();
  expect(formatPrice(-1, 'USD')).toBeNull();
});

test('parseRating', () => {
  expect(parseRating('4.5 out of 5 stars.')).toBe(4.5);
  expect(parseRating('4,5 von 5 Sternen')).toBe(4.5);
  expect(parseRating('5.0 out of 5 stars.')).toBe(5);
  expect(parseRating('88 product ratings')).toBeNull();
  expect(parseRating(null)).toBeNull();
});

test('parseReviewCount only trusts a labelled count', () => {
  expect(parseReviewCount('2 product ratings')).toBe(2);
  expect(parseReviewCount('1,234 product ratings')).toBe(1234);
  expect(parseReviewCount('4.0 out of 5 stars. 2 product ratings - Apple AirPods 4')).toBe(2);
  expect(parseReviewCount('88 Produktbewertungen')).toBe(88);
  expect(parseReviewCount('851 sold')).toBeNull();
  expect(parseReviewCount('anshop_llc 98.3% positive (33.1K)')).toBeNull();
});

test('itemIdFromHref', () => {
  expect(itemIdFromHref('https://www.ebay.com/itm/405662453606?_skw=x&hash=item1')).toBe('405662453606');
  expect(itemIdFromHref('https://www.ebay.de/itm/Some-Title/358831537533')).toBe('358831537533');
  // the decoy cards link to /itm/123456 — too short to be an item number
  expect(itemIdFromHref('https://ebay.com/itm/123456?itmmeta=x')).toBeNull();
  expect(itemIdFromHref(null)).toBeNull();
});

test('buildSearchUrl uses the marketplace host', () => {
  expect(buildSearchUrl(resolveMarketplace('EBUS'), ' yoga mat ')).toBe('https://www.ebay.com/sch/i.html?_nkw=yoga%20mat');
  expect(buildSearchUrl(resolveMarketplace('ebde'), 'kopfhörer')).toBe('https://www.ebay.de/sch/i.html?_nkw=kopfh%C3%B6rer');
});

test('resolveMarketplace rejects an unknown code and names the known ones', () => {
  expect(() => resolveMarketplace('EBXX')).toThrow(/Known eBay codes: EBUS, EBUK, EBDE, EBAU/);
});
