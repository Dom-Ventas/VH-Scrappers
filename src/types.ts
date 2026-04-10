export interface Query {
  id: string;
  shortCode: string;
  searchTerm: string;
}

export interface Product {
  position: number;
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
