export interface Query {
  productId: number;
  sku: string;
  shortCode: string;
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

export interface ScrapedResult {
  emailId: string;
  profileId: string;
  productId: number;
  sku: string;
  shortCode: string;
  rating: number;
  ratingCount: number;
  criticalReviews: Record<string, any>;

  // Both casings are sent so one backend handler can serve the Amazon,
  // Flipkart and Noon scrapers unchanged.
  delivery_promise_days?: number | null;
  deliveryPromiseDays?: number | null;

  price?: number | null;
  currency?: string;
  availability?: string;
}

export interface UserSettings {
  emailId: string;
  profileIds: string[];
  firstRunCompletedAt: string;
}
