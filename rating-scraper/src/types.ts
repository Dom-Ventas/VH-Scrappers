/** One product page to scrape, as the VentaWiz review queue hands it out. */
export interface Query {
  /** Every listing this page answers for — copied verbatim into the result. */
  productIds: number[];
  /** mp_product_id: the ASIN (upper-cased by the backend). */
  asin: string;
  /** Marketplace short code, e.g. "AZAE" — resolved to a host via marketplaces.ts. */
  shortCode: string;
  storeId: number;
}

export interface Review {
  rating: number;
  title?: string;
  text?: string;
  author?: string;
  date?: string;
}

export interface ProductReviewResult {
  asin: string;
  title: string;
  rating: number;
  totalRatings: number;
  bestSellersRank?: string;
  criticalReviews?: Review[];
  aplus_content?: "yes" | "no";
  aplusContent?: "yes" | "no";
  /** Promised delivery date minus today, in whole days. null when not readable. */
  deliveryPromiseDays?: number | null;
  /** Raw delivery text the day count was parsed from (logging/debug only). */
  deliveryText?: string;
}

/** POST /v1/scrapper/reviews body — one per queue item. */
export interface ScrapedResult {
  store_id: number;
  product_ids: number[];
  /** 0–5, at most 2 decimals; null when unreadable. */
  rating: number | null;
  rating_count: number | null;
  /** Always an object, never a bare array. */
  critical_reviews: { reviews: Review[] } | null;
  aplus_content: "yes" | "no" | null;
  /** Promised delivery date minus today, in whole days. null when not readable. */
  delivery_promise_days: number | null;
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
