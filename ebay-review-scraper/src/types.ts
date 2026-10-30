/** One listing to scrape — a VentaWiz review-queries item. */
export interface Query {
  /** Every focused listing this page answers for; posted back verbatim. */
  productIds: number[];
  /**
   * eBay's item number ("265983500898"), which is what VentaWiz stores as
   * `mp_product_id` for every eBay listing. `/itm/<itemId>` opens the listing
   * on every eBay site.
   */
  itemId: string;
  shortCode: string;
  storeId: number;
}

export interface Review {
  /** eBay's own id for the review (`review_<id>`); used to drop repeats. */
  reviewId?: string;
  rating: number;
  title?: string;
  text?: string;
  author?: string;
  date?: string;
  /** eBay prints "Verified purchase: Yes" under reviews by buyers. */
  verifiedPurchase?: boolean;
}

export interface ProductReviewResult {
  itemId: string;
  /**
   * eBay's catalogue product id ("17054784938") — the product the listing is
   * matched to. Reviews and ratings belong to the product, not the listing,
   * so every seller of the same product shows the same ones. null when the
   * listing is not matched to a catalogue product: then eBay has no star
   * reviews for it at all (only seller feedback, which is not used).
   */
  epid: string | null;
  title: string | null;
  /** Average star rating 0–5; null when the product has no ratings. */
  rating: number | null;
  /** How many ratings the average covers; null when unreadable. */
  ratingCount: number | null;
  criticalReviews: Review[];
  /** How many 1–2 star ratings eBay's histogram reports — what the harvest aims for. */
  criticalExpected: number | null;
  /** Earliest estimated delivery date minus today, in whole days. null when not readable. */
  deliveryPromiseDays: number | null;
  /** The "Delivery:" text the day count came from (debug only). */
  deliveryText: string | null;
  // Extras that come free with the listing page.
  price: number | null;
  currency: string | null;
}

/** POST body for /v1/scrapper/reviews — one per queue item. */
export interface ScrapedResult {
  store_id: number;
  product_ids: number[];
  /** 0–5, at most 2 decimals; null when unreadable. */
  rating: number | null;
  rating_count: number | null;
  critical_reviews: { reviews: Review[] } | null;
  /** eBay has no A+ module, so always null. */
  aplus_content: 'yes' | 'no' | null;
  delivery_promise_days: number | null;

  // eBay-only extras: the backend ignores unknown fields, kept for the record.
  epid?: string | null;
  price?: number | null;
  currency?: string | null;
}

export interface UserSettings {
  emailId: string;
  /** VentaWiz store ids (positive integers). */
  storeIds: number[];
  firstRunCompletedAt: string;
}
