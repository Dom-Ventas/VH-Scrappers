export interface AgentConfig {
  deviceId: string;
  emailId: string;
  /** VentaWiz store ids (positive integers) chosen at first run. */
  storeIds: number[];
  /** VentaWiz service account client id (`svc_…`). Safe to log. */
  clientId: string;
  /** VentaWiz service account client secret (`vws_…`). NEVER log it. */
  clientSecret: string;
  firstRunCompletedAt: string;
}

// ─── Wire types ───────────────────────────────────────────────────────────────
// Snake_case, exactly as the VentaWiz backend sends and expects them. The
// backend rejects unknown request fields (422), so request bodies carry these
// fields and nothing else.

/** POST /v1/scrapper/checkin request body. */
export interface CheckinRequest {
  device_id: string;
  agent_kind: string; // amazon | flipkart | noon | otto
  store_ids: number[]; // 1–50
  email: string;
  hostname: string;
  os: string;
  agent_version: string;
}

export interface Assignment {
  scraper_key: string;
  kind: string; // ads | reviews
  /** Handed to the scraper as SCRAPE_MARKETPLACE → `marketplace=` on its queue. */
  marketplace: string;
  exe_name: string;
  /** Path relative to the API root, already including /v1, e.g. "/v1/scrapper/review-queries". */
  query_endpoint: string;
  results_endpoint: string;
}

export interface CheckinResponse {
  device_id: string;
  status: string; // active | disabled | retired
  assignments: Assignment[];
  server_time: string;
}

/** What last-assignment.json holds: the check-in reply plus when it was cached. */
export interface CachedAssignment {
  cachedAt: string;
  response: CheckinResponse;
}

/** POST /v1/scrapper/runs request body. */
export interface RunReport {
  device_id: string;
  scraper_key: string;
  cycle_id: string;
  started_at: string;
  finished_at: string;
  status: string; // success | partial | failed | crashed | skipped
  exit_code: number | null;
  items_ok: number;
  items_failed: number;
  items_total: number;
  error_msg: string | null;
  /** At most 200 lines, oldest first. */
  log_tail: string[];
}
