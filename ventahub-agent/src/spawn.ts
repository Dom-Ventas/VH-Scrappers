import { spawn } from 'child_process';
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
 * valid settings and skips its own first-run form — no scraper code change
 * needed. The child reads it from SCRAPER_PROFILE_DIR/user-settings.json.
 */
function seedChildSettings(agent: AgentConfig): void {
  fs.mkdirSync(config.chromeProfileDir, { recursive: true });
  fs.writeFileSync(
    path.join(config.chromeProfileDir, 'user-settings.json'),
    JSON.stringify(
      {
        emailId: agent.emailId,
        profileIds: agent.profileIds,
        firstRunCompletedAt: agent.firstRunCompletedAt,
      },
      null,
      2,
    ),
    'utf-8',
  );
}

/**
 * Run one scraper exe to completion. Item counts are derived by counting the
 * scrapers' existing "[OK]" / "[FAIL]" / "[DONE]" stdout markers, so no scraper
 * change is required to get run monitoring.
 */
export async function runScraper(
  assignment: Assignment,
  agent: AgentConfig,
): Promise<ChildResult> {
  const exePath = path.join(config.scraperDir, assignment.exeName);
  if (!fs.existsSync(exePath)) {
    throw new Error(`scraper exe not found: ${exePath}`);
  }

  seedChildSettings(agent);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SCRAPER_PROFILE_DIR: config.chromeProfileDir,
    QUERIES_API_URL: `${config.apiRoot}${assignment.queryEndpoint}`,
    RESULTS_API_URL: `${config.apiRoot}${assignment.resultsEndpoint}`,
    API_TOKEN: config.apiToken,
    BROWSER_VISIBLE: config.childVisible ? '1' : '0',
    DEFAULT_AMAZON_DOMAIN: config.defaultAmazonDomain,
  };
  if (assignment.shortCodes) childEnv.SCRAPE_SHORT_CODES = assignment.shortCodes;

  return await new Promise<ChildResult>((resolve) => {
    const child = spawn(exePath, [], { env: childEnv, windowsHide: true });

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
      pushLine(`[LAUNCHER] spawn error: ${err.message}`);
      resolve({ exitCode: null, itemsOk, itemsFailed, sawDone, logTail: tail });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code, itemsOk, itemsFailed, sawDone, logTail: tail });
    });
  });
}
