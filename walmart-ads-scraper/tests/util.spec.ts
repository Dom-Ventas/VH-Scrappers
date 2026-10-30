import { test, expect } from '@playwright/test';
import {
  formatPrice,
  parseDeliveryDays,
  parseRating,
  parseReviewCount,
  parseWalmartPrice,
  pickDelivery,
} from '../src/util';
import { buildSearchUrl } from '../src/scraper';
import { resolveMarketplace } from '../src/marketplaces';
import { isAdHref, itemIdFromHref } from '../src/extractors';

// Tuesday 13 Oct 2026, mid-day so a timezone shift cannot move the date.
const NOW = new Date(2026, 9, 13, 12, 0, 0);

test.describe('parseDeliveryDays — Walmart badge shapes', () => {
  const cases: Array<[string, number | null]> = [
    ['Delivery as soon as 13 mins', 0],
    ['Delivery as soon as 1 hour', 0],
    ['Arrives today', 0],
    ['Free shipping, arrives tomorrow', 1],
    ['Shipping, arrives tomorrow', 1],
    ['Shipping, arrives Wed, Oct 14', 1],
    ['Free shipping, arrives Thu, Oct 15', 2],
    ['Shipping, arrives Oct 14 - Oct 16', 1],
    ['Shipping, arrives Oct 14 - 16', 1],
    ['Shipping, arrives in 2+ days', 2],
    ['Free shipping, arrives in 3-5 days', 3],
    ['Arrives within 4 business days', 4],
    ['arrives 10/14', 1],
    ['arrives Mon, Jan 4', 83], // already past this year -> next year
    ['arrives Fri', 3],
    ['arrives Tue', 7], // today's weekday means next week
    ['Free shipping', null],
    ['Low stock', null],
    ['', null],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" -> ${expected}`, () => {
      expect(parseDeliveryDays(text, NOW)).toBe(expected);
    });
  }

  test('a trailing year is not read as a day', () => {
    expect(parseDeliveryDays('arrives Oct 14, 2026', NOW)).toBe(1);
  });

  test('null / undefined', () => {
    expect(parseDeliveryDays(null, NOW)).toBeNull();
    expect(parseDeliveryDays(undefined, NOW)).toBeNull();
  });
});

test.describe('pickDelivery — which badge line wins', () => {
  test('express delivery beats shipping; pickup is ignored', () => {
    const pick = pickDelivery(
      [
        "In 10K+ people's carts",
        'Save with',
        'Delivery as soon as 13 mins',
        'Free shipping, arrives tomorrow',
        'Free pickup as soon as tomorrow',
      ],
      NOW,
    );
    expect(pick).toEqual({ deliveryText: 'Delivery as soon as 13 mins', deliveryDays: 0 });
  });

  test('a lone shipping promise', () => {
    expect(pickDelivery(['Save with', 'Shipping, arrives Wed, Oct 14', 'Low stock'], NOW)).toEqual({
      deliveryText: 'Shipping, arrives Wed, Oct 14',
      deliveryDays: 1,
    });
  });

  test('pickup-only tiles have no delivery promise', () => {
    expect(pickDelivery(['Pickup as soon as tomorrow', 'Best seller'], NOW)).toEqual({
      deliveryText: null,
      deliveryDays: null,
    });
  });

  test('a dateless delivery line is kept as text with null days', () => {
    expect(pickDelivery(['Free shipping', 'Rollback'], NOW)).toEqual({
      deliveryText: 'Free shipping',
      deliveryDays: null,
    });
  });

  test('the dated line wins over an earlier dateless one', () => {
    expect(pickDelivery(['Free shipping', 'Arrives tomorrow'], NOW)).toEqual({
      deliveryText: 'Arrives tomorrow',
      deliveryDays: 1,
    });
  });
});

test.describe('prices', () => {
  test('parseWalmartPrice reads the screen-reader price line', () => {
    expect(parseWalmartPrice('Price $363.00 Options from $159.99')).toBe(363);
    expect(parseWalmartPrice('Price Now $20.99 Was $159.95 Options from $14.00')).toBe(20.99);
    expect(parseWalmartPrice('Price Now $1,299.00 Was $1,499.00')).toBe(1299);
    expect(parseWalmartPrice('current price $359.00')).toBe(359);
    expect(parseWalmartPrice('Price Options from $14.00')).toBe(14);
    expect(parseWalmartPrice('Price $5')).toBe(5);
    expect(parseWalmartPrice('Low stock')).toBeNull();
    expect(parseWalmartPrice(null)).toBeNull();
  });

  test('formatPrice emits "<currency> <amount>" with a dot decimal', () => {
    expect(formatPrice(363, 'USD')).toBe('USD 363.00');
    expect(formatPrice(20.99, 'USD')).toBe('USD 20.99');
    expect(formatPrice(1299, 'USD')).toBe('USD 1299.00');
    expect(formatPrice(null, 'USD')).toBeNull();
    expect(formatPrice(NaN, 'USD')).toBeNull();
  });
});

test('parseRating trusts only the "out of 5" shape', () => {
  expect(parseRating('4.6 out of 5 stars')).toBe(4.6);
  expect(parseRating('4.3 out of 5 Stars. 86071 reviews')).toBe(4.3);
  expect(parseRating('5 out of 5 stars')).toBe(5);
  expect(parseRating('4.5')).toBe(4.5);
  expect(parseRating('4502')).toBeNull();
  expect(parseRating('')).toBeNull();
});

test('parseReviewCount never confuses the rating for the count', () => {
  expect(parseReviewCount('4502')).toBe(4502);
  expect(parseReviewCount('1,234')).toBe(1234);
  expect(parseReviewCount('86071 reviews')).toBe(86071);
  expect(parseReviewCount('4.3 out of 5 Stars. 86071 reviews')).toBe(86071);
  expect(parseReviewCount('1 review')).toBe(1);
  expect(parseReviewCount('4.3 out of 5 stars')).toBeNull();
  expect(parseReviewCount('')).toBeNull();
});

test('buildSearchUrl puts the encoded term in the query string', () => {
  const wm = resolveMarketplace('WMUS');
  expect(buildSearchUrl(wm, ' bluetooth headphones ')).toBe(
    'https://www.walmart.com/search?q=bluetooth%20headphones',
  );
  expect(buildSearchUrl({ ...wm, url: 'https://www.walmart.com/' }, 'tv 55"/4k?&')).toBe(
    'https://www.walmart.com/search?q=tv%2055%22%2F4k%3F%26',
  );
});

test('itemIdFromHref reads organic and ad-redirect hrefs', () => {
  expect(itemIdFromHref('/ip/Apple-AirPods-4/11381374703?classType=REGULAR&from=/search')).toBe('11381374703');
  expect(itemIdFromHref('https://www.walmart.com/ip/11381374703')).toBe('11381374703');
  expect(
    itemIdFromHref(
      'https://www.walmart.com/sp/track?bt=1&eventST=click&plmt=sp-search-middle&pos=1&rdf=1' +
        '&rd=https%3A%2F%2Fwww.walmart.com%2Fip%2FBose-QuietComfort%2F9744661583%3FclassType%3DVARIANT%26adsRedirect%3Dtrue&adUid=abc',
    ),
  ).toBe('9744661583');
  expect(itemIdFromHref('/search?q=x')).toBeNull();
  expect(itemIdFromHref(null)).toBeNull();
});

test('isAdHref flags only the ad-click tracker', () => {
  expect(isAdHref('https://www.walmart.com/sp/track?bt=1&rd=…')).toBe(true);
  expect(isAdHref('/ip/Apple-AirPods-4/11381374703')).toBe(false);
  expect(isAdHref(null)).toBe(false);
});

test("resolveMarketplace knows the backend's Walmart code and rejects others", () => {
  expect(resolveMarketplace('WMUS')).toMatchObject({ url: 'www.walmart.com', currency: 'USD' });
  expect(resolveMarketplace('wmus').url).toBe('www.walmart.com');
  expect(() => resolveMarketplace('FKIN')).toThrow(/Unknown short_code "FKIN".*WMUS/);
});
