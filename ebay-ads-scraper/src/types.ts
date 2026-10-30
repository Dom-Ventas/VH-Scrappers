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
   * eBay's item number ("405662453606") — the card's `data-listingid`, the id
   * in `/itm/<itemId>`. This is what VentaWiz stores as `mp_product_id` for
   * every eBay listing (`marketplace_listed_product`: "item_number (ebay)"), so
   * it is what goes out as `mp_product_id` — a competitor row can then be
   * matched against our own listings. The same number opens the listing on
   * every eBay site.
   */
  itemId: string | null;
  isSponsored: boolean;
  title: string | null;
  /** "<currency> <amount>", e.g. "USD 15.49". */
  price: string | null;
  rating: number | null;
  /** eBay's "N product ratings" — catalogue-level, absent on most listings. */
  reviewCount: number | null;
  /** The delivery line the days were read from — kept for audit/debug. */
  deliveryText: string | null;
  /** Number of days from today to the earliest promised delivery. null if not parseable. */
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
