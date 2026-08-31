export interface Query {
  productId: number;
  /** Flipkart PID — the ASIN equivalent, e.g. "MOBGTAGPTB3VS24W". */
  pid: string;
  shortCode: string;
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

export interface ScrapedResult {
  emailId: string;
  profileId: string;
  productId: number;
  pid: string;
  shortCode: string;
  rating: number;
  ratingCount: number;
  criticalReviews: Record<string, any>;
  aplus_content?: "yes" | "no";
  aplusContent?: "yes" | "no";
  /** Promised delivery date minus today, in whole days. null when not readable. */
  delivery_promise_days?: number | null;
  deliveryPromiseDays?: number | null;
  pincode_applied?: boolean | null;
  pincodeApplied?: boolean | null;
}

export interface UserSettings {
  emailId: string;
  profileIds: string[];
  firstRunCompletedAt: string;
}
// The delivery pincode is deliberately not stored here. It is set by the user
// on Flipkart during first-run login and lives in the Chrome profile, because
// that is the only place it takes effect (see firstRun.ts). Whether it is still
// applied is checked per scrape and reported as `pincodeApplied`.
