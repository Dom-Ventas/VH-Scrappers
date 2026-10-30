/** One search to run — a VentaWiz search-term queue item. */
export interface Query {
  storeId: number;
  shortCode: string;
  /** Exactly as the queue handed it out; posted back unchanged. */
  searchTerm: string;
}

export interface Product {
  position: number;
  /**
   * Noon's product identifier (SKU, e.g. "N70034197V" or
   * "Z38F7F87F384F17FD4824Z" — noon issues both shapes).
   *
   * Posted to VentaWiz as `mp_product_id` (see ResultProduct below).
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

/** One product card as VentaWiz's search-term-results endpoint takes it. */
export interface ResultProduct {
  position: number | null;
  mp_product_id: string;
  is_sponsored: boolean;
  price: string | null;
  /** 0–5, else null. */
  rating: number | null;
  /** >= 0, else null. */
  review_count: number | null;
  /** >= 0, else null. */
  delivery_days: number | null;
  /** Ignored by the backend; kept for anyone reading the payload. */
  title: string | null;
}

/** POST body for /v1/scrapper/search-term-results — one per search. */
export interface ScrapedResult {
  store_id: number;
  search_term: string;
  products: ResultProduct[];
}

/** 201 body from /v1/scrapper/search-term-results. */
export interface StoredResult {
  id: number;
  store_id: number;
  search_term: string;
  sponsored: number;
  organic: number;
  created_at: string;
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
