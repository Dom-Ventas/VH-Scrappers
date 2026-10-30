export interface MarketplaceConfig {
  /** Walmart host, e.g. "www.walmart.com" */
  url: string;
  /**
   * ISO currency code for this storefront.
   *
   * Walmart prints "$363.00", which the backend's parse_price() reads fine on
   * its own — but a bare "$" is ambiguous the day a WMCA (CAD) or WMMX (MXN)
   * store appears, so extractProduct() re-emits every price as
   * "<currency> <amount>" ("USD 363.00"), the same self-describing shape the
   * noon ("AED 165.30") and Otto ("EUR 1299.00") scrapers send.
   */
  currency: string;
  /**
   * Reference delivery ZIP for this marketplace.
   *
   * INERT — nothing reads this field; it documents a sensible default, nothing
   * more. (Same in the Amazon, Flipkart and noon scrappers.) Walmart resolves
   * delivery from the store/ZIP the session picked in the header ("Pickup or
   * delivery?"), which lives in the persistent Chrome profile, so what applies
   * is whatever the user set during first-run. Editing this changes nothing.
   */
  zipcode: string;
}

/**
 * Short codes are NOT ours to invent — they are `com_marketplace.short_code`
 * values from the VentaWiz backend, and every queue item carries one. VentaWiz
 * recognises a Walmart store by the `WM` prefix (`ventawiz/scrapper/catalog.py`,
 * `_SHORT_CODE_PREFIX`), so a new Walmart country is handed to this scraper
 * the moment its marketplace row exists — and fails here with "Unknown
 * short_code" until it is added below. That is deliberate: walmart.ca and
 * walmart.com.mx are different sites with different markup, so a new code
 * must come with verified selectors, not a guessed host.
 *
 * `WMUS` ("Walmart US") is the only Walmart row in the backend today.
 */
export const MARKETPLACES: Record<string, MarketplaceConfig> = {
  WMUS: { url: 'www.walmart.com', currency: 'USD', zipcode: '95829' },
};

export function resolveMarketplace(shortCode: string): MarketplaceConfig {
  const cfg = MARKETPLACES[shortCode.toUpperCase()];
  if (!cfg) {
    // Name the valid codes in the message, so it is obvious at a glance whether
    // the DB gained a marketplace this table has not been taught about.
    throw new Error(
      `Unknown short_code "${shortCode}". Known Walmart codes: ${Object.keys(MARKETPLACES).join(', ')}. ` +
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
