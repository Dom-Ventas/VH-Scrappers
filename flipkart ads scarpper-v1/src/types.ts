/** One search to run, as the VentaWiz search-term queue hands it out. */
export interface Query {
  storeId: number;
  shortCode: string;
  searchTerm: string;
}

/** One product card as scraped. Converted to a ResultProduct before posting. */
export interface Product {
  position: number;
  /**
   * Flipkart's product identifier (PID, e.g. "MOBGTAGPTB3VS24W"). Kept as
   * `asin` internally to match the extractors; posted as `mp_product_id`.
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

/** One product card in the body of POST /v1/scrapper/search-term-results. */
export interface ResultProduct {
  position: number;
  mp_product_id: string;
  is_sponsored: boolean;
  price: string | null;
  rating: number | null;
  review_count: number | null;
  /** Always null: Flipkart's results page shows no delivery promise. */
  delivery_days: number | null;
  title: string | null;
}

/** Body of POST /v1/scrapper/search-term-results — one per search. */
export interface ScrapedResult {
  store_id: number;
  /** Exactly as the queue handed it out. */
  search_term: string;
  products: ResultProduct[];
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
