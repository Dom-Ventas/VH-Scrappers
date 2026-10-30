export interface MarketplaceConfig {
  /** eBay host, e.g. "www.ebay.com" */
  url: string;
  /**
   * ISO currency code for this site. eBay prints "$15.49", "£37.09",
   * "EUR 16,57" or "AU $12.00"; extractProduct() re-emits every price as
   * "<currency> <amount>" ("USD 15.49"), the same self-describing shape the
   * noon ("AED 165.30"), Otto ("EUR 1299.00") and Walmart scrapers send.
   */
  currency: string;
  /**
   * The site prints prices with a decimal comma ("EUR 1.234,56" on ebay.de).
   * Read by parseEbayPrice() so "16,57" is 16.57, not 1657.
   */
  decimalComma: boolean;
  /**
   * Reference delivery postcode for this marketplace.
   *
   * INERT — nothing reads this field; it documents a sensible default, nothing
   * more. (Same in the other scrapers.) eBay resolves "Shipping to" from the
   * location the session picked ("Update your location"), which lives in the
   * persistent Chrome profile — per eBay site — so what applies is whatever
   * the user set during first-run. Editing this changes nothing.
   */
  zipcode: string;
}

/**
 * Short codes are NOT ours to invent — they are `com_marketplace.short_code`
 * values from the VentaWiz backend, and every queue item carries one. eBay
 * rows use the `EB` prefix (`EBDE` and `EBAU` appear in VentaWiz's tests), so
 * a code missing here fails with "Unknown short_code" rather than guessing a
 * host.
 *
 * All eBay sites run the same search page (`li.s-card`, the same obfuscated
 * "Sponsored"/"Anzeige" label), so a new country is a host + currency entry.
 * Verified live on 2026-10-14: www.ebay.com, www.ebay.de, www.ebay.co.uk.
 */
export const MARKETPLACES: Record<string, MarketplaceConfig> = {
  EBUS: { url: 'www.ebay.com', currency: 'USD', decimalComma: false, zipcode: '10001' },
  EBUK: { url: 'www.ebay.co.uk', currency: 'GBP', decimalComma: false, zipcode: 'SW1A 1AA' },
  EBDE: { url: 'www.ebay.de', currency: 'EUR', decimalComma: true, zipcode: '10115' },
  EBAU: { url: 'www.ebay.com.au', currency: 'AUD', decimalComma: false, zipcode: '2000' },
};

export function resolveMarketplace(shortCode: string): MarketplaceConfig {
  const cfg = MARKETPLACES[shortCode.toUpperCase()];
  if (!cfg) {
    // Name the valid codes in the message, so it is obvious at a glance whether
    // the DB gained a marketplace this table has not been taught about.
    throw new Error(
      `Unknown short_code "${shortCode}". Known eBay codes: ${Object.keys(MARKETPLACES).join(', ')}. ` +
        'Add the marketplace to src/marketplaces.ts if the backend has a new one.',
    );
  }
  if (!cfg.url) {
    throw new Error(
      `short_code "${shortCode}" has no url configured in src/marketplaces.ts`,
    );
  }
  return cfg;
}
