import { checkinUrl, runsUrl, config } from './config';
import { CheckinResponse, RunReport } from './types';

const TIMEOUT_MS = 30_000;

async function postJson(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkin(body: {
  deviceId: string;
  email: string;
  profileIds: string[];
  hostname: string;
  os: string;
  agentVersion: string;
}): Promise<CheckinResponse> {
  const res = await postJson(checkinUrl(), body);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`checkin ${res.status} ${res.statusText} ${text}`.trim());
  }
  return (await res.json()) as CheckinResponse;
}

/** Best-effort — a failed run report must never fail the cycle. */
export async function reportRun(report: RunReport): Promise<void> {
  try {
    const res = await postJson(runsUrl(), report);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[RUNS] report failed ${res.status} ${res.statusText} ${text}`.trim());
    }
  } catch (err) {
    console.error('[RUNS] report error', (err as Error).message);
  }
}
