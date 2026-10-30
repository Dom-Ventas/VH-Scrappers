import * as path from 'path';

// ─── EXE CWD BOOTSTRAP ────────────────────────────────────────────────────────
// When packaged with pkg the process starts with CWD = wherever it was
// launched from. Playwright loads runtime files via relative require(), so we
// pin CWD to the exe's own directory (same pattern as the scrapers).
if ((process as { pkg?: unknown }).pkg !== undefined) {
  process.chdir(path.dirname(process.execPath));
}
// ──────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';

import { config } from './config';
import { checkin, reportRun } from './api';
import { AuthError, getAccessToken, useServiceAccount } from './auth';
import { effectiveCredentials, loadAgentConfig, runFirstLaunch } from './firstRun';
import { ChildResult, killActiveChild, runScraper } from './spawn';
import { AgentConfig, CachedAssignment, CheckinResponse } from './types';

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(config.logsDir, { recursive: true });
    fs.appendFileSync(path.join(config.logsDir, 'agent.log'), line + '\n');
  } catch {
    /* ignore log write failures */
  }
}

/**
 * Clear every lock this agent can be blocked by, unconditionally, at startup:
 * the agent's own cycle.lock and Chrome's profile lock files. A killed run
 * (console closed, Task Scheduler time limit, sleep) leaves these behind, and
 * they used to block runs for hours. No single-instance guard remains — Task
 * Scheduler's IgnoreNew is what stops scheduled cycles from overlapping.
 */
function clearLocks(): void {
  const files = [
    config.lockPath,
    // Windows uses `lockfile`; Linux/macOS use the Singleton* trio.
    ...['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'].map((name) =>
      path.join(config.chromeProfileDir, name),
    ),
  ];
  for (const file of files) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* still held by a running Chrome — leave it */
    }
  }
}

/**
 * Read the cached assignment, but only if it is from the last cycle (cached at
 * most `cacheMaxAgeMs` ago). The server alternates ads and reviews per 2-hour
 * block, so an older one would run the wrong kind. A pre-VentaWiz cache (no
 * `cachedAt`) is treated as stale.
 */
function readFreshCache(): CheckinResponse | null {
  try {
    if (!fs.existsSync(config.cachePath)) return null;
    const cached = JSON.parse(fs.readFileSync(config.cachePath, 'utf-8')) as Partial<CachedAssignment>;
    const cachedAtMs = cached.cachedAt ? Date.parse(cached.cachedAt) : NaN;
    if (!cached.response || Number.isNaN(cachedAtMs)) {
      log('[CHECKIN] cached assignment has no timestamp — ignoring it');
      return null;
    }
    const ageMs = Date.now() - cachedAtMs;
    if (ageMs < 0 || ageMs > config.cacheMaxAgeMs) {
      log(`[CHECKIN] cached assignment is from ${cached.cachedAt} — too old, ignoring it`);
      return null;
    }
    log(`[CHECKIN] replaying assignment cached at ${cached.cachedAt}`);
    return cached.response;
  } catch {
    return null;
  }
}

/** Check in with VentaWiz; fall back to a fresh cached assignment on failure. */
async function getAssignment(agent: AgentConfig): Promise<CheckinResponse | null> {
  try {
    const resp = await checkin({
      device_id: agent.deviceId,
      // Declares which marketplace this exe is, so the backend serves only
      // that marketplace's scrapers.
      agent_kind: config.agentKind,
      store_ids: agent.storeIds,
      email: agent.emailId,
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      agent_version: config.agentVersion,
    });
    try {
      const cached: CachedAssignment = { cachedAt: new Date().toISOString(), response: resp };
      fs.writeFileSync(config.cachePath, JSON.stringify(cached), 'utf-8');
    } catch {
      /* cache is best-effort */
    }
    return resp;
  } catch (err) {
    // Rejected credentials / missing scrapper:run: the children would fail
    // the same way, so replaying a cached assignment only adds noise.
    if (err instanceof AuthError) {
      log(`[CHECKIN] ${err.message} — not running any scraper`);
      return null;
    }
    log(`[CHECKIN] failed (${(err as Error).message}) — trying cached assignment`);
    return readFreshCache();
  }
}

function classify(
  errorMsg: string | null,
  exitCode: number | null,
  sawDone: boolean,
  itemsOk: number,
  itemsFailed: number,
): string {
  if (errorMsg) return 'failed';
  if (exitCode === null) return 'crashed';
  if (exitCode !== 0) return 'failed';
  if (!sawDone) return 'partial';
  if (itemsFailed > 0 && itemsOk === 0) return 'failed';
  if (itemsFailed > 0) return 'partial';
  return 'success';
}

async function main(): Promise<void> {
  log(
    `[BOOT] VentaWiz Agent v${config.agentVersion} kind=${config.agentKind} ` +
      `home=${config.home}`,
  );

  let agent = loadAgentConfig();
  if (!agent) {
    agent = await runFirstLaunch();
  }
  const credentials = effectiveCredentials(agent);
  useServiceAccount(credentials);
  // Client id only — the secret is never logged.
  log(
    `[BOOT] device=${agent.deviceId} email=${agent.emailId} ` +
      `stores=[${agent.storeIds.join(',')}] client=${credentials.clientId} ` +
      `auth=${config.authRoot}`,
  );

  // Fail fast on rejected credentials, before touching locks or Chrome. A
  // network failure here is not fatal: check-in falls back to the cache.
  try {
    await getAccessToken();
  } catch (err) {
    if (err instanceof AuthError) {
      log(
        `[FATAL] ${err.message}. Fix the service account, or delete ` +
          `${config.configPath} to enter a new client id/secret, then re-run.`,
      );
      process.exit(1);
    }
    log(`[AUTH] token exchange failed (${(err as Error).message}) — continuing`);
  }

  clearLocks();

  const cycleId = randomUUID();
  const resp = await getAssignment(agent);
  if (!resp) {
    log('[CHECKIN] no assignment available (and no recent cache) — nothing to do');
    return;
  }

  if (resp.status !== 'active') {
    log(`[ASSIGN] device status=${resp.status} — no scrapers to run`);
    return;
  }
  if (!resp.assignments.length) {
    log('[ASSIGN] no scrapers assigned to this device this cycle');
    return;
  }

  log(`[ASSIGN] running: ${resp.assignments.map((a) => a.scraper_key).join(', ')}`);

  // Sequential — the scrapers share ONE Chrome profile (Chromium locks it).
  for (const a of resp.assignments) {
    const startedAt = new Date().toISOString();
    log(`[RUN] starting ${a.scraper_key} (${a.exe_name}) marketplace=${a.marketplace}`);

    let errorMsg: string | null = null;
    let result: ChildResult;
    try {
      result = await runScraper(a, agent, credentials);
    } catch (err) {
      errorMsg = (err as Error).message;
      result = { exitCode: null, itemsOk: 0, itemsFailed: 0, sawDone: false, logTail: [errorMsg] };
    }

    const finishedAt = new Date().toISOString();
    const status = classify(
      errorMsg,
      result.exitCode,
      result.sawDone,
      result.itemsOk,
      result.itemsFailed,
    );

    log(
      `[RUN] ${a.scraper_key} → ${status} ok=${result.itemsOk} ` +
        `failed=${result.itemsFailed} exit=${result.exitCode}`,
    );

    await reportRun({
      device_id: agent.deviceId,
      scraper_key: a.scraper_key,
      cycle_id: cycleId,
      started_at: startedAt,
      finished_at: finishedAt,
      status,
      exit_code: result.exitCode,
      items_ok: result.itemsOk,
      items_failed: result.itemsFailed,
      items_total: result.itemsOk + result.itemsFailed,
      error_msg: errorMsg,
      log_tail: result.logTail,
    });
  }

  log('[DONE] cycle complete');
}

// Ctrl+C or closing the console window: stop the running scraper (and its
// Chrome) instead of leaving it running in the background.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(signal, () => {
    log(`[STOP] received ${signal} — stopping scraper`);
    killActiveChild();
    process.exit(130);
  });
}

main().catch((err) => {
  log(`[FATAL] ${err?.stack || err}`);
  process.exit(1);
});
