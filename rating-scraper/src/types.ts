export interface Query {
  productId: number;
  asin: string;
  shortCode: string;
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

export interface ScrapedResult {
  emailId: string;
  profileId: string;
  productId: number;
  asin: string;
  shortCode: string;
  rating: number;
  ratingCount: number;
  criticalReviews: Record<string, any>;
  aplus_content?: "yes" | "no";
  aplusContent?: "yes" | "no";
  /** Promised delivery date minus today, in whole days. null when not readable. */
  delivery_promise_days?: number | null;
  deliveryPromiseDays?: number | null;
}

export interface UserSettings {
  emailId: string;
  profileIds: string[];
  firstRunCompletedAt: string;
}