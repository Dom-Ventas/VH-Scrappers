export interface AgentConfig {
  deviceId: string;
  emailId: string;
  profileIds: string[];
  firstRunCompletedAt: string;
}

export interface Assignment {
  scraperKey: string;
  kind: string;
  exeName: string;
  /** Path relative to VH_API_ROOT, e.g. "/api/v1/scrapper/queries". */
  queryEndpoint: string;
  resultsEndpoint: string;
  shortCodes: string | null;
}

export interface CheckinResponse {
  deviceId: string;
  status: string; // active | disabled | retired
  assignments: Assignment[];
  config: { scrapeDelayMs: number; checkInIntervalMinutes: number };
  serverTime: string;
}

export interface RunReport {
  deviceId: string;
  scraperKey: string;
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  status: string; // success | partial | failed | crashed
  exitCode: number | null;
  itemsOk: number;
  itemsFailed: number;
  itemsTotal: number;
  errorMsg: string | null;
  logTail: string[];
}
