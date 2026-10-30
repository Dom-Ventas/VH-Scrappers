/** One product page to scrape, as the VentaWiz review queue hands it out. */
export interface Query {
  /** Every focused listing this page answers for — posted back verbatim. */
  productIds: number[];
  /** Flipkart PID/FSN (queue `mp_product_id`), e.g. "MOBGTAGPTB3VS24W". */
  pid: string;
  shortCode: string;
  storeId: number;
}

export interface Review {
  rating: number;
  title?: string;
  text?: string;
  author?: string;
  /** Flipkart shows the reviewer's city next to their name. */
  location?: string;
  /** Raw relative date as rendered — "Today", "3 days ago", "5 months ago". */
  date?: string;
  /** Resolved offset in days from today, when `date` was parseable. */
  dateDays?: number | null;
  verifiedPurchase?: boolean;
  /** Upvotes the review has received. */
  helpfulCount?: number;
  /** Flipkart's own review id — stable across runs, useful for dedupe. */
  reviewId?: string;
  /** Body was clipped with "...more" and could not be expanded. */
  truncated?: boolean;
}

export interface ProductReviewResult {
  pid: string;
  title: string;
  rating: number;
  totalRatings: number;
  /** Flipkart has no Best Sellers Rank — this holds the breadcrumb category path. */
  bestSellersRank?: string;
  criticalReviews?: Review[];
  /** Whether the product has Rich Product Description content. */
  aplus_content?: "yes" | "no";
  aplusContent?: "yes" | "no";
  /** Promised delivery date minus today, in whole days. null when not readable. */
  deliveryPromiseDays?: number | null;
  /** Raw delivery text the day count was parsed from (logging/debug only). */
  deliveryText?: string;
  /**
   * false when Flipkart still shows "Location not set" — promises are
   * geo-guessed. null when the page did not render enough to tell.
   */
  pincodeApplied?: boolean | null;
}

/** Body of POST /v1/scrapper/reviews — one per queue item. */
export interface ScrapedResult {
  store_id: number;
  /** Copied verbatim from the queue item. */
  product_ids: number[];
  /** 0–5, at most two decimals; null when the page shows no average. */
  rating: number | null;
  rating_count: number | null;
  critical_reviews: { reviews: Review[] } | null;
  aplus_content: "yes" | "no" | null;
  /** Promised delivery date minus today, in whole days. null when not readable. */
  delivery_promise_days: number | null;
  /** Flipkart-only extra; the backend ignores it. */
  pincode_applied?: boolean | null;
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
