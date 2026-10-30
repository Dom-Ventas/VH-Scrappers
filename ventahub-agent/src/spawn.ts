import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { AgentConfig, Assignment } from './types';

export interface ChildResult {
  exitCode: number | null;
  itemsOk: number;
  itemsFailed: number;
  sawDone: boolean;
  logTail: string[];
}

/**
 * Pre-seed the shared profile's user-settings.json so the child scraper finds
 * valid settings and skips its own first-run form. The child reads it from
 * SCRAPER_PROFILE_DIR/user-settings.json; SCRAPE_STORE_IDS in its env wins
 * over the file's storeIds, so this is the fallback, kept in the same shape.
 */
function seedChildSettings(agent: AgentConfig): void {
  fs.mkdirSync(config.chromeProfileDir, { recursive: true });
  fs.writeFileSync(
    path.join(config.chromeProfileDir, 'user-settings.json'),
    JSON.stringify(
      {
        // Deliberately NOT the service account: the child gets it via env,
        // and the secret must not sit in the shared profile folder.
        emailId: agent.emailId,
        storeIds: agent.storeIds,
        firstRunCompletedAt: agent.firstRunCompletedAt,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

let activeChild: ChildProcess | null = null;

/** Kill the running scraper and everything it started (its Chrome included). */
export function killActiveChild(): void {
  const child = activeChild;
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * Run one scraper exe to completion. Item counts are derived by counting the
 * scrapers' existing "[OK]" / "[FAIL]" / "[DONE]" stdout markers, so no scraper
 * change is required to get run monitoring.
 */
export async function runScraper(
  assignment: Assignment,
  agent: AgentConfig,
  credentials: { clientId: string; clientSecret: string },
): Promise<ChildResult> {
  const exePath = path.join(config.scraperDir, assignment.exe_name);
  if (!fs.existsSync(exePath)) {
    throw new Error(`scraper exe not found: ${exePath}`);
  }

  seedChildSettings(agent);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SCRAPER_PROFILE_DIR: config.chromeProfileDir,
    // The endpoints already include /v1, so they hang straight off the root.
    QUERIES_API_URL: `${config.apiRoot}${assignment.query_endpoint}`,
    RESULTS_API_URL: `${config.apiRoot}${assignment.results_endpoint}`,
    // The service account itself, NOT a token: a scraper run outlives a
    // 10-minute access token, so each child exchanges (and re-exchanges) its own.
    VW_CLIENT_ID: credentials.clientId,
    VW_CLIENT_SECRET: credentials.clientSecret,
    VW_AUTH_URL: config.authRoot,
    // The scraper sends these as store_id=…&marketplace=… on its queue request.
    SCRAPE_STORE_IDS: agent.storeIds.join(','),
    SCRAPE_MARKETPLACE: assignment.marketplace,
    BROWSER_VISIBLE: config.childVisible ? '1' : '0',
    DEFAULT_AMAZON_DOMAIN: config.defaultAmazonDomain,
  };
  // Never inherit a stale short-code filter from the agent's own environment:
  // the work is chosen by store id now.
  delete childEnv.SCRAPE_SHORT_CODES;
  // Nor a leftover static token from an old .env — it is no longer accepted.
  delete childEnv.API_TOKEN;

  return await new Promise<ChildResult>((resolve) => {
    const child = spawn(exePath, [], { env: childEnv, windowsHide: true });
    activeChild = child;

    let itemsOk = 0;
    let itemsFailed = 0;
    let sawDone = false;
    const tail: string[] = [];

    const pushLine = (line: string): void => {
      if (!line) return;
      if (line.includes('[OK]')) itemsOk++;
      if (line.includes('[FAIL]')) itemsFailed++;
      if (line.includes('[DONE]')) sawDone = true;
      tail.push(line);
      if (tail.length > 40) tail.shift();
    };

    const wire = (buf: Buffer): void => {
      const text = buf.toString();
      process.stdout.write(text); // mirror child output into the agent log
      text.split(/\r?\n/).forEach((l) => pushLine(l.trim()));
    };

    child.stdout?.on('data', wire);
    child.stderr?.on('data', wire);

    child.on('error', (err) => {
      activeChild = null;
      pushLine(`[LAUNCHER] spawn error: ${err.message}`);
      resolve({ exitCode: null, itemsOk, itemsFailed, sawDone, logTail: tail });
    });
    child.on('close', (code) => {
      activeChild = null;
      resolve({ exitCode: code, itemsOk, itemsFailed, sawDone, logTail: tail });
    });
  });
}
