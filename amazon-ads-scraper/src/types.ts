/** One search to run, as the VentaWiz queue hands it out. */
export interface Query {
  storeId: number;
  /** Marketplace short code, e.g. "AZAE" — resolved to a host via marketplaces.ts. */
  shortCode: string;
  /** Sent back verbatim in the result: the backend matches on it. */
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

/** One product card as POSTed to VentaWiz. Missing values are null, never 0 / -1. */
export interface ResultProduct {
  position: number;
  /** The ASIN. */
  mp_product_id: string;
  is_sponsored: boolean;
  /** As printed; the backend parses every country's format. */
  price: string | null;
  rating: number | null;
  review_count: number | null;
  delivery_days: number | null;
  /** Ignored by the backend; kept for anyone reading the request log. */
  title: string | null;
}

/** POST /v1/scrapper/search-term-results body — one per search. */
export interface ScrapedResult {
  store_id: number;
  search_term: string;
  products: ResultProduct[];
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
