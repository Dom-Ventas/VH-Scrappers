export interface Marketplace {
  url: string;
  /**
   * Fallback delivery pincode, used when the user left the first-run pincode
   * field blank. Unlike the Amazon scraper — where this field is declared but
   * never read — Flipkart actually consumes it.
   */
  zipcode: string;
}

/**
 * Flipkart operates only in India, so there is one live entry. The registry
 * shape is kept identical to the Amazon scraper so the short-code plumbing,
 * the SCRAPE_SHORT_CODES filter and the per-profile loop all work unchanged —
 * and so adding another Flipkart Group surface later stays a one-line change.
 */
export const MARKETPLACES: Record<
  string,
  Marketplace
> = {
  FKIN: {
    url: 'www.flipkart.com',
    zipcode: '110001'
  }
};

export function resolveMarketplace(
  shortCode: string
): Marketplace {
  const cfg =
    MARKETPLACES[
      shortCode.toUpperCase()
    ];

  if (!cfg) {
    throw new Error(
      `Unknown short_code: ${shortCode}`
    );
  }

  return cfg;
}
