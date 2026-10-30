import { authFetch } from './auth';
import { checkinUrl, runsUrl } from './config';
import { CheckinRequest, CheckinResponse, RunReport } from './types';

const TIMEOUT_MS = 30_000;

/** POST JSON to the VentaWiz API with the service account's bearer token. */
async function postJson(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `agent_kind` declares which launcher exe this is (amazon | flipkart | noon),
 * so the backend serves only that marketplace's scrapers.
 */
export async function checkin(body: CheckinRequest): Promise<CheckinResponse> {
  const res = await postJson(checkinUrl(), body);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`checkin ${res.status} ${res.statusText} ${text}`.trim());
  }
  return (await res.json()) as CheckinResponse;
}

/** The backend rejects a run report over these limits (422). */
const MAX_LOG_TAIL = 200;
const MAX_ERROR_MSG = 4000;

/** Best-effort — a failed run report must never fail the cycle. */
export async function reportRun(report: RunReport): Promise<void> {
  try {
    const res = await postJson(runsUrl(), {
      ...report,
      log_tail: report.log_tail.slice(-MAX_LOG_TAIL),
      error_msg: report.error_msg?.slice(0, MAX_ERROR_MSG) ?? null,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[RUNS] report failed ${res.status} ${res.statusText} ${text}`.trim());
    }
  } catch (err) {
    console.error('[RUNS] report error', (err as Error).message);
  }
}
