export interface Query {
  id: string;
  shortCode: string;
  searchTerm: string;
}

export interface Product {
  position: number;
  /**
   * Flipkart's product identifier (PID, e.g. "MOBGTAGPTB3VS24W").
   *
   * The field is deliberately still named `asin` so the JSON payload posted to
   * the backend is byte-for-byte compatible with the Amazon scrapper's
   * contract — the backend stores it in the same column either way.
   */
  asin: string | null;
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
