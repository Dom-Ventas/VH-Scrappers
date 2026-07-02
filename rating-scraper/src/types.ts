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
}

export interface UserSettings {
  emailId: string;
  profileIds: string[];
  firstRunCompletedAt: string;
}