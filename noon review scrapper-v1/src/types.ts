/** One product page to scrape — a VentaWiz review-queries item. */
export interface Query {
  /** Every focused listing this page answers for; posted back verbatim. */
  productIds: number[];
  /** noon's zsku / SKU (the queue's `mp_product_id`). */
  sku: string;
  shortCode: string;
  storeId: number;
}

export interface Review {
  rating: number;
  title?: string;
  text?: string;
  author?: string;
  date?: string;
  /** Noon shows a "Verified Purchase" badge per review card. */
  verifiedPurchase?: boolean;
}

export interface ProductReviewResult {
  sku: string;
  title: string;
  brand?: string;
  rating: number;
  totalRatings: number;
  criticalReviews?: Review[];

  /** Promised delivery date minus today, in whole days. null when not readable. */
  deliveryPromiseDays?: number | null;
  /** Raw delivery text or JSON-LD source the day count came from (debug only). */
  deliveryText?: string;

  // Extras that come free with the JSON-LD parse.
  price?: number | null;
  currency?: string;
  availability?: string;
}

/** POST body for /v1/scrapper/reviews — one per queue item. */
export interface ScrapedResult {
  store_id: number;
  product_ids: number[];
  /** 0–5, at most 2 decimals; null when unreadable. */
  rating: number | null;
  rating_count: number | null;
  critical_reviews: { reviews: Review[] } | null;
  /** noon has no A+ module, so always null. */
  aplus_content: 'yes' | 'no' | null;
  delivery_promise_days: number | null;

  // noon-only extras: the backend ignores unknown fields, kept for the record.
  price?: number | null;
  currency?: string;
  availability?: string;
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
