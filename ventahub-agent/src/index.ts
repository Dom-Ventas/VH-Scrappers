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
import { loadAgentConfig, runFirstLaunch } from './firstRun';
import { ChildResult, runScraper } from './spawn';
import { AgentConfig, CheckinResponse } from './types';

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

/** Single-instance guard so an overrunning cycle can't overlap the next wake. */
function acquireLock(): boolean {
  try {
    fs.mkdirSync(config.home, { recursive: true });
    if (fs.existsSync(config.lockPath)) {
      const ageMs = Date.now() - fs.statSync(config.lockPath).mtimeMs;
      // Steal a stale lock (a crashed cycle) after 2h.
      if (ageMs < 2 * 60 * 60 * 1000) return false;
    }
    fs.writeFileSync(config.lockPath, String(process.pid), { flag: 'w' });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(config.lockPath);
  } catch {
    /* ignore */
  }
}

/** Check in with VentaHub; fall back to the last cached assignment on failure. */
async function getAssignment(agent: AgentConfig): Promise<CheckinResponse | null> {
  try {
    const resp = await checkin({
      deviceId: agent.deviceId,
      email: agent.emailId,
      profileIds: agent.profileIds,
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      agentVersion: config.agentVersion,
    });
    try {
      fs.writeFileSync(config.cachePath, JSON.stringify(resp), 'utf-8');
    } catch {
      /* cache is best-effort */
    }
    return resp;
  } catch (err) {
    log(`[CHECKIN] failed (${(err as Error).message}) — trying cached assignment`);
    try {
      if (fs.existsSync(config.cachePath)) {
        return JSON.parse(fs.readFileSync(config.cachePath, 'utf-8')) as CheckinResponse;
      }
    } catch {
      /* ignore */
    }
    return null;
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
  log(`[BOOT] VentaHub Agent v${config.agentVersion} home=${config.home}`);

  if (!config.apiToken) {
    log(
      '[FATAL] API_TOKEN is not set. Put a .env next to VentaHubAgent.exe with ' +
        'API_TOKEN=<token> (see .env.example), then re-run.',
    );
    process.exit(1);
  }

  let agent = loadAgentConfig();
  if (!agent) {
    agent = await runFirstLaunch();
  }
  log(
    `[BOOT] device=${agent.deviceId} email=${agent.emailId} ` +
      `profiles=[${agent.profileIds.join(',')}]`,
  );

  if (!acquireLock()) {
    log('[LOCK] another cycle is already running — exiting');
    return;
  }

  try {
    const cycleId = randomUUID();
    const resp = await getAssignment(agent);
    if (!resp) {
      log('[CHECKIN] no assignment available (and no cache) — nothing to do');
      return;
    }

    if (resp.status !== 'active') {
      log(`[ASSIGN] device status=${resp.status} — no scrapers to run`);
      return;
    }
    if (!resp.assignments.length) {
      log('[ASSIGN] no scrapers assigned to this device today');
      return;
    }

    log(`[ASSIGN] running: ${resp.assignments.map((a) => a.scraperKey).join(', ')}`);

    // Sequential — the scrapers share ONE Chrome profile (Chromium locks it).
    for (const a of resp.assignments) {
      const startedAt = new Date().toISOString();
      log(`[RUN] starting ${a.scraperKey} (${a.exeName})`);

      let errorMsg: string | null = null;
      let result: ChildResult;
      try {
        result = await runScraper(a, agent);
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
        `[RUN] ${a.scraperKey} → ${status} ok=${result.itemsOk} ` +
          `failed=${result.itemsFailed} exit=${result.exitCode}`,
      );

      await reportRun({
        deviceId: agent.deviceId,
        scraperKey: a.scraperKey,
        cycleId,
        startedAt,
        finishedAt,
        status,
        exitCode: result.exitCode,
        itemsOk: result.itemsOk,
        itemsFailed: result.itemsFailed,
        itemsTotal: result.itemsOk + result.itemsFailed,
        errorMsg,
        logTail: result.logTail,
      });
    }

    log('[DONE] cycle complete');
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  log(`[FATAL] ${err?.stack || err}`);
  releaseLock();
  process.exit(1);
});
