export interface MarketplaceConfig {
  /** Noon host, e.g. "www.noon.com" */
  url: string;
  /**
   * Storefront path segment, e.g. "uae-en".
   *
   * Unlike Flipkart (one host, one storefront), noon serves every country from
   * the SAME host and scopes the storefront in the first path segment:
   * `noon.com/uae-en/search/?q=...`. Get this wrong and you silently scrape
   * another country's catalogue and currency, so it is resolved from the short
   * code rather than guessed.
   */
  locale: string;
  /**
   * ISO currency code for this storefront.
   *
   * Noon renders the currency as an icon-font glyph with NO text content
   * (`<span class="_currency_..."></span>`), so scraping the card yields a bare
   * "165.30". This is the only place the currency is recoverable, and
   * extractProduct() prefixes it to keep `price` a self-describing string
   * ("AED 165.30") the way Flipkart's "₹1,299" is.
   */
  currency: string;
  /**
   * Reference delivery pincode for this marketplace.
   *
   * INERT — nothing reads this field; it documents a sensible default, nothing
   * more. (Same in the Amazon and Flipkart scrappers.) Noon does not use
   * postcodes at all — it resolves delivery from a saved address/area — so what
   * actually applies is whatever the user picks in the browser during
   * first-run, which noon stores in the persistent Chrome profile. Editing the
   * value here changes nothing about a scrape.
   */
  zipcode: string;
}

/**
 * Short codes are NOT ours to invent — they are primary keys from the backend's
 * marketplace table, and the launcher passes the same strings through as a
 * filter. If this map and the DB disagree, the failure is silent and total: the
 * launcher hands the child a SCRAPE_SHORT_CODES filter that matches nothing, so
 * every query is filtered out and the run reports success having scraped zero
 * keywords. (That is exactly what "NOAE/NOSA/NOEG" caused — invented codes that
 * no marketplace row uses.)
 *
 * The real codes are `NN`-prefixed. Noon runs an Egypt storefront on the web,
 * but there is no marketplace row for it, so there is no code to add here —
 * add one only when the DB does.
 *
 * Unlike Flipkart (one host, one storefront), noon serves every country from
 * the SAME host and scopes the storefront in the first path segment, so each
 * row carries the locale and currency that go with the code.
 */
export const MARKETPLACES: Record<string, MarketplaceConfig> = {
  NNAE: { url: 'www.noon.com', locale: 'uae-en', currency: 'AED', zipcode: '00000' },
  NNSA: { url: 'www.noon.com', locale: 'saudi-en', currency: 'SAR', zipcode: '11564' },
};

export function resolveMarketplace(shortCode: string): MarketplaceConfig {
  const cfg = MARKETPLACES[shortCode.toUpperCase()];
  if (!cfg) {
    // Name the valid codes in the message. A bare "Unknown short_code: NNKW"
    // sends you hunting through the backend; this tells you immediately whether
    // the DB gained a marketplace this table has not been taught about.
    throw new Error(
      `Unknown short_code "${shortCode}". Known noon codes: ${Object.keys(MARKETPLACES).join(', ')}. ` +
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
