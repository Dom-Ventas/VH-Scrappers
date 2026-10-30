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
   * Walmart's product id — the "wpid" ("243ESPUGUSOJ"), the tile's
   * `data-item-id`. This is what VentaWiz stores as `mp_product_id` for every
   * Walmart listing (`marketplace_listed_product`: "wpid (walmart)"), so it is
   * what goes out as `mp_product_id` — a competitor row can then be matched
   * against our own listings. walmart.com/ip/<wpid> resolves the product page.
   */
  wpid: string | null;
  /**
   * Walmart's numeric item id ("9744661583") — the id in the canonical URL
   * `/ip/<slug>/<itemId>`, the tile's `data-dca-id`. Sent as the extra field
   * `item_id`, which the backend ignores, for anyone reading the payload.
   */
  itemId: string | null;
  isSponsored: boolean;
  title: string | null;
  /** "<currency> <amount>", e.g. "USD 363.00". */
  price: string | null;
  rating: number | null;
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
  /** Ignored by the backend; Walmart's numeric item id for anyone reading the payload. */
  item_id: string | null;
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
