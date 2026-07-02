import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import { EMBEDDED_API_ROOT, EMBEDDED_TOKEN } from './embedded';

dotenv.config();

function agentHome(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'VentaHubAgent');
}

const home = process.env.VH_AGENT_HOME?.trim() || agentHome();

export const config = {
  home,

  // ONE shared Chrome profile for every scraper → the employee logs into
  // Amazon once and all scrapers reuse the session.
  chromeProfileDir: path.join(home, 'chrome-profile'),
  configPath: path.join(home, 'agent-config.json'),
  cachePath: path.join(home, 'last-assignment.json'),
  lockPath: path.join(home, 'cycle.lock'),
  logsDir: path.join(home, 'logs'),

  chromeChannel: 'chrome' as const,
  navigationTimeoutMs: 30_000,

  // apiRoot = server root (the FastAPI app is mounted under root_path "/backend").
  apiRoot: (process.env.VH_API_ROOT?.trim() || EMBEDDED_API_ROOT).replace(/\/+$/, ''),
  // Token resolution: runtime env (.env) first, else the value baked into the
  // exe at build time (empty in source; injected by CI from a secret).
  apiToken: process.env.API_TOKEN?.trim() || EMBEDDED_TOKEN,

  defaultAmazonDomain: process.env.DEFAULT_AMAZON_DOMAIN || 'www.amazon.in',

  agentVersion: '1.0.0',

  // Folder holding the child scraper exes — defaults to the agent exe's folder.
  scraperDir: process.env.VH_SCRAPER_DIR?.trim() || path.dirname(process.execPath),

  // Debug: show the child scraper browser windows.
  childVisible: process.env.BROWSER_VISIBLE === '1',
};

export function checkinUrl(): string {
  return `${config.apiRoot}/api/v1/scrapper/checkin`;
}

export function runsUrl(): string {
  return `${config.apiRoot}/api/v1/scrapper/runs`;
}
