import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import { EMBEDDED_AGENT_KIND, EMBEDDED_API_ROOT, EMBEDDED_TOKEN } from './embedded';

dotenv.config();

export type AgentKind = 'amazon' | 'flipkart' | 'noon';

/**
 * Per-marketplace identity for this build.
 *
 * `dirName` is the ONLY thing that separates two agents on one laptop —
 * everything stateful (Chrome profile, device id, lock, cached assignment,
 * logs) hangs off the home directory it produces. `firstRunDomain` is the site
 * the employee signs into during setup; each agent needs its own session
 * because Chromium locks a persistent profile to one process.
 *
 * The amazon row's `dirName` is deliberately the historical `VentaHubAgent`,
 * so an existing laptop keeps its home, its device id and therefore its
 * manager-set assignment. Changing it would make every device re-register as
 * new and silently revert to the global default.
 */
const AGENT_KINDS: Record<AgentKind, { dirName: string; firstRunDomain: string }> = {
  amazon: { dirName: 'VentaHubAgent', firstRunDomain: 'www.amazon.in' },
  flipkart: { dirName: 'VentaHubAgentFlipkart', firstRunDomain: 'www.flipkart.com' },
  noon: { dirName: 'VentaHubAgentNoon', firstRunDomain: 'www.noon.com' },
};

// VH_AGENT_KIND is a local override for testing two kinds off one build; the
// baked-in constant is what ships. An unknown value falls back to amazon
// rather than crashing — a mis-set env var should not brick the laptop.
const rawKind = (process.env.VH_AGENT_KIND?.trim() || EMBEDDED_AGENT_KIND) as AgentKind;
const agentKind: AgentKind = rawKind in AGENT_KINDS ? rawKind : 'amazon';
const kindSpec = AGENT_KINDS[agentKind];

function agentHome(): string {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, kindSpec.dirName);
}

// VH_AGENT_HOME is treated as a BASE directory, with the kind appended — so
// two agents sharing one folder (and therefore one .env) cannot collapse into
// the same home. It used to be an exact path; it is a testing override only.
const homeBase = process.env.VH_AGENT_HOME?.trim();
const home = homeBase ? path.join(homeBase, kindSpec.dirName) : agentHome();

export const config = {
  agentKind,
  home,

  // ONE Chrome profile per agent → the employee signs into this agent's
  // marketplace once, and every child scraper it launches reuses that session.
  // Separate agents keep separate profiles, which is what lets them run at the
  // same time instead of fighting over Chromium's profile lock.
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

  // The site first-run opens for the one-time sign-in, per marketplace.
  firstRunDomain: kindSpec.firstRunDomain,

  // Still passed to Amazon child scrapers as DEFAULT_AMAZON_DOMAIN. Only the
  // amazon agent's children read it; the others resolve their host from the
  // marketplace short code the assignment carries.
  defaultAmazonDomain: process.env.DEFAULT_AMAZON_DOMAIN || 'www.amazon.in',

  // Bumped for the per-marketplace split — reported on check-in, so the fleet
  // list shows which laptops are running a split-aware build.
  agentVersion: '1.1.0',

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
