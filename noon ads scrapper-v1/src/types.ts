export interface Query {
  id: string;
  shortCode: string;
  searchTerm: string;
}

export interface Product {
  position: number;
  /**
   * Noon's product identifier (SKU, e.g. "N70034197V" or
   * "Z38F7F87F384F17FD4824Z" — noon issues both shapes).
   *
   * NOTE — this is the ONE place this scrapper's payload deliberately diverges
   * from the Amazon and Flipkart scrappers, which post the same value under the
   * legacy key `asin`. "ASIN" is an Amazon term that means nothing on noon, so
   * this one is named for what it actually holds. The backend needs a
   * noon-specific mapping for this key (or the sibling scrappers need the same
   * rename); every other field in ScrapedResult is unchanged.
   */
  sku: string | null;
  isSponsored: boolean;
  title: string | null;
  price: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Raw delivery text scraped from the card — kept for audit/debug. */
  deliveryText: string | null;
  /** Number of days from today to the earliest promised delivery date. null if not parseable. */
  deliveryDays: number | null;
}

export interface ScrapedResult {
  emailId: string;
  profileId: string;
  queryId: string;
  shortCode: string;
  searchTerm: string;
  scrapedAt: string;
  products: Product[];
}

export interface UserSettings {
  emailId: string;
  profileIds: string[];
  firstRunCompletedAt: string;
}
