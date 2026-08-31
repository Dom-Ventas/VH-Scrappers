export interface MarketplaceConfig {
  /** Flipkart host, e.g. "www.flipkart.com" */
  url: string;
  /**
   * Reference delivery pincode for this marketplace.
   *
   * INERT — nothing reads this field; it documents a sensible default, nothing
   * more. (Same in the Amazon scrapper, whose set-amazon-zip.ts takes the zip
   * from argv rather than from this table.) The pincode that actually applies
   * is whatever the user sets in the browser during first-run, which Flipkart
   * stores in the persistent Chrome profile. Editing the value here changes
   * nothing about a scrape.
   */
  zipcode: string;
}

/**
 * Flipkart only operates one storefront (India), so unlike the Amazon
 * scrapper's 16-entry table there is a single real short code here. The map is
 * kept for shape-compatibility: the backend still sends a `short_code` on every
 * query and the scrapper still resolves it to a host + default pincode.
 *
 * `url` is left blank for the reserved codes below — fill them in if/when those
 * storefronts exist. resolveMarketplace() throws on a blank url rather than
 * silently building "https:///search?q=...".
 */
export const MARKETPLACES: Record<string, MarketplaceConfig> = {
  FKIN: { url: 'www.flipkart.com', zipcode: '110001' },
  // Reserved for future Flipkart-group storefronts. Add the host to enable.
  FKGR: { url: '', zipcode: '' },
  FKWS: { url: '', zipcode: '' },
};

export function resolveMarketplace(shortCode: string): MarketplaceConfig {
  const cfg = MARKETPLACES[shortCode.toUpperCase()];
  if (!cfg) throw new Error(`Unknown short_code: ${shortCode}`);
  if (!cfg.url) {
    throw new Error(
      `short_code "${shortCode}" has no url configured in src/marketplaces.ts`,
    );
  }
  return cfg;
}
