/** One product page to scrape — a VentaWiz review-queries item. */
export interface Query {
  /** Every focused listing this page answers for; posted back verbatim. */
  productIds: number[];
  /**
   * Walmart's product id — the "wpid" ("243ESPUGUSOJ"), which is what VentaWiz
   * stores as `mp_product_id` for every Walmart listing. walmart.com/ip/<wpid>
   * opens the product page; the reviews page needs the numeric item id read
   * off that page.
   */
  wpid: string;
  shortCode: string;
  storeId: number;
}

export interface Review {
  /**
   * Walmart's own id for the review. Posted along with the review (the backend
   * stores the list as sent) and used to drop repeats: Walmart shuffles tied
   * 1-star reviews between page loads, so page 2 can repeat part of page 1.
   */
  reviewId?: string;
  rating: number;
  title?: string;
  text?: string;
  author?: string;
  date?: string;
  /** Walmart marks reviews by buyers with a "Verified Purchase" badge. */
  verifiedPurchase?: boolean;
}

export interface ProductReviewResult {
  wpid: string;
  /** Walmart's numeric item id ("11381374703"), read off the product page. */
  itemId: string | null;
  title: string | null;
  brand: string | null;
  /** Average star rating 0–5; null when the product has no ratings. */
  rating: number | null;
  /** How many ratings the average covers; null when unreadable. */
  ratingCount: number | null;
  criticalReviews: Review[];
  /** How many 1–2 star reviews with text Walmart says exist — what the harvest aims for. */
  criticalExpected: number | null;
  /** Promised delivery date minus today, in whole days. null when not readable. */
  deliveryPromiseDays: number | null;
  /** The fulfillment option / text the day count came from (debug only). */
  deliveryText: string | null;
  // Extras that come free with the product data.
  price: number | null;
  currency: string | null;
  availability: string | null;
}

/** POST body for /v1/scrapper/reviews — one per queue item. */
export interface ScrapedResult {
  store_id: number;
  product_ids: number[];
  /** 0–5, at most 2 decimals; null when unreadable. */
  rating: number | null;
  rating_count: number | null;
  critical_reviews: { reviews: Review[] } | null;
  /** Walmart has no A+ module, so always null. */
  aplus_content: 'yes' | 'no' | null;
  delivery_promise_days: number | null;

  // Walmart-only extras: the backend ignores unknown fields, kept for the record.
  item_id?: string | null;
  price?: number | null;
  currency?: string | null;
  availability?: string | null;
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
