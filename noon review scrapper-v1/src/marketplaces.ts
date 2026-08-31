export interface MarketplaceConfig {
  /** Host plus locale path, e.g. "www.noon.com/uae-en". */
  url: string;

  /**
   * Noon picks a delivery area by city, not by postcode — this is the Noon
   * equivalent of the zipcode field the Amazon scraper carries.
   */
  city: string;

  currency: string;

  country: string;
}

/**
 * Keyed by the marketplace `short_code` the backend sends on every query, so
 * these keys must match the Marketplace table exactly — a code that is not in
 * here fails that SKU, and a code in here that the DB never sends is dead
 * weight that hides the mismatch.
 *
 * The DB defines exactly two Noon storefronts. The other noon.com sites
 * (Egypt, Kuwait, Bahrain, Oman, Qatar) are deliberately absent: no
 * marketplace row exists for them, so nothing can arrive carrying their code.
 * Add an entry here at the same time one is added to the Marketplace table.
 */
export const MARKETPLACES: Record<
  string,
  MarketplaceConfig
> = {
  /** Noon UAE */
  NNAE: {
    url: 'www.noon.com/uae-en',
    city: 'Dubai',
    currency: 'AED',
    country: 'United Arab Emirates'
  },

  /** Noon KSA */
  NNSA: {
    url: 'www.noon.com/saudi-en',
    city: 'Riyadh',
    currency: 'SAR',
    country: 'Saudi Arabia'
  }
};

export function resolveMarketplace(
  shortCode: string
): MarketplaceConfig {

  const marketplace =
    MARKETPLACES[
      shortCode.trim().toUpperCase()
    ];

  if (!marketplace) {

    throw new Error(
      `Unknown short_code: ${shortCode} ` +
        `(known: ${Object.keys(MARKETPLACES).join(', ')})`
    );
  }

  return marketplace;
}
