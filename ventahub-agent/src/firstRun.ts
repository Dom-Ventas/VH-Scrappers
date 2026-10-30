import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium } from 'playwright';
import { config } from './config';
import { checkin } from './api';
import { AuthError, useServiceAccount } from './auth';
import { AgentConfig } from './types';
import { getOrCreateDeviceId } from './deviceId';
import { signInSites } from './sites';

/** The backend accepts 1–50 store ids on a check-in. */
const MAX_STORE_IDS = 50;

const CLIENT_ID_PREFIX = 'svc_';
const CLIENT_SECRET_PREFIX = 'vws_';

/** True when both env overrides are set (dev: VW_CLIENT_ID / VW_CLIENT_SECRET). */
function envCredentials(): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

/** Positive integers only, de-duplicated; anything else is dropped. */
function toStoreIds(values: unknown[]): number[] {
  const ids = values
    .map((v) => (typeof v === 'number' ? v : Number(String(v).trim())))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

function readRawConfig(): Partial<AgentConfig> | null {
  try {
    if (!fs.existsSync(config.configPath)) return null;
    return JSON.parse(fs.readFileSync(config.configPath, 'utf-8')) as Partial<AgentConfig>;
  } catch {
    return null;
  }
}

/**
 * Returns null — which sends the employee through first-run again — when there
 * is no config, when it is a legacy VentaHub config that only carries
 * `profileIds` (AMS profile ids are not VentaWiz store ids, so they cannot be
 * carried over), or when it predates service accounts and has no client
 * id/secret (unless both VW_CLIENT_ID / VW_CLIENT_SECRET are set in the env).
 * The device id is kept either way (it lives in device.id too).
 */
export function loadAgentConfig(): AgentConfig | null {
  try {
    const parsed = readRawConfig();
    if (!parsed) return null;
    if (!parsed.emailId || !Array.isArray(parsed.storeIds)) return null;
    const storeIds = toStoreIds(parsed.storeIds);
    if (storeIds.length === 0 || storeIds.length > MAX_STORE_IDS) return null;
    const clientId = typeof parsed.clientId === 'string' ? parsed.clientId.trim() : '';
    const clientSecret =
      typeof parsed.clientSecret === 'string' ? parsed.clientSecret.trim() : '';
    const savedOk =
      clientId.startsWith(CLIENT_ID_PREFIX) && clientSecret.startsWith(CLIENT_SECRET_PREFIX);
    if (!savedOk && !envCredentials()) return null;
    return {
      deviceId: parsed.deviceId || getOrCreateDeviceId(config.home),
      emailId: parsed.emailId,
      storeIds,
      clientId,
      clientSecret,
      firstRunCompletedAt: parsed.firstRunCompletedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveAgentConfig(cfg: AgentConfig): void {
  fs.mkdirSync(path.dirname(config.configPath), { recursive: true });
  fs.writeFileSync(config.configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * The service account to use: VW_CLIENT_ID / VW_CLIENT_SECRET from the env when
 * both are set (dev), else the pair saved at first run.
 */
export function effectiveCredentials(agent: AgentConfig): { clientId: string; clientSecret: string } {
  return envCredentials()
    ? { clientId: config.clientId, clientSecret: config.clientSecret }
    : { clientId: agent.clientId, clientSecret: agent.clientSecret };
}

interface SetupForm {
  emailId: string;
  storeIds: number[];
  clientId: string;
  clientSecret: string;
}

/**
 * First-time setup: collect the employee's email + VentaWiz store IDs + the
 * laptop's VentaWiz service account (client id + secret), then open THIS
 * agent's marketplace on its own Chrome profile for a one-time sign-in. Every
 * scraper this agent launches reuses that profile, so the login happens once
 * per marketplace per laptop.
 *
 * A laptop running the Amazon and Noon agents signs into Amazon once and Noon
 * once, in two separate profiles. Chromium locks a persistent profile to one
 * process, which is why they cannot share it — and also why their sessions do
 * not interfere.
 */
export async function runFirstLaunch(): Promise<AgentConfig> {
  console.log(`[FIRST-RUN] No agent config found — starting setup (${config.agentKind})`);

  fs.mkdirSync(config.chromeProfileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(config.chromeProfileDir, {
    headless: false,
    channel: config.chromeChannel,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  const page = await context.newPage();

  let resolver!: (v: SetupForm) => void;
  const formPromise = new Promise<SetupForm>((resolve) => {
    resolver = resolve;
  });

  await page.exposeFunction(
    '__saveAgentSetup',
    async (data: {
      emailId: string;
      storeIds: unknown[];
      clientId: string;
      clientSecret: string;
    }) => {
      resolver({
        emailId: String(data.emailId || '').trim(),
        storeIds: toStoreIds(data.storeIds || []),
        clientId: String(data.clientId || '').trim(),
        clientSecret: String(data.clientSecret || '').trim(),
      });
    },
  );

  await page.setContent(FORM_HTML);

  // An old config (pre-service-account) re-runs setup: keep what it knew.
  const previous = readRawConfig();
  if (previous) {
    await page
      .evaluate(
        (p: { emailId: string; storeIds: string }) => {
          (document.getElementById('email') as HTMLInputElement).value = p.emailId;
          (document.getElementById('stores') as HTMLTextAreaElement).value = p.storeIds;
        },
        {
          emailId: typeof previous.emailId === 'string' ? previous.emailId : '',
          storeIds: Array.isArray(previous.storeIds)
            ? toStoreIds(previous.storeIds).join(', ')
            : '',
        },
      )
      .catch(() => undefined);
  }

  const form = await formPromise;
  if (!form.emailId || form.storeIds.length === 0 || form.storeIds.length > MAX_STORE_IDS) {
    await context.close();
    throw new Error(
      `Setup incomplete: email and 1–${MAX_STORE_IDS} store IDs (whole numbers) are required`,
    );
  }
  if (
    !form.clientId.startsWith(CLIENT_ID_PREFIX) ||
    !form.clientSecret.startsWith(CLIENT_SECRET_PREFIX)
  ) {
    await context.close();
    throw new Error(
      `Setup incomplete: the client ID must start with "${CLIENT_ID_PREFIX}" and the ` +
        `client secret with "${CLIENT_SECRET_PREFIX}"`,
    );
  }
  // Client id only — the secret is never logged.
  console.log(`[FIRST-RUN] service account: ${form.clientId}`);

  // Ask the backend which marketplace each store is on, so the employee signs in
  // to every site the scrapers will open (amazon.ae for a UAE store, amazon.in
  // for an Indian one) rather than one fixed country. This is also the first
  // check-in: a wrong store id or credential fails here, before anything is saved.
  const deviceId = getOrCreateDeviceId(config.home);
  let sites: string[];
  try {
    sites = await sitesForStores(deviceId, form);
  } catch (err) {
    await context.close();
    throw err;
  }

  console.log(
    `[FIRST-RUN] Sign in to ${sites.join(', ')} and set your delivery ` +
      'address/pincode on each, then close the tabs',
  );
  const tabs = [page];
  for (let i = 1; i < sites.length; i++) tabs.push(await context.newPage());
  await Promise.all(
    tabs.map((tab, i) => tab.goto(`https://${sites[i]}`, { waitUntil: 'domcontentloaded' })),
  );

  // Done when every sign-in tab is closed, or after ten minutes.
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10 * 60 * 1000);
    let open = tabs.length;
    for (const tab of tabs) {
      tab.once('close', () => {
        open -= 1;
        if (open === 0) {
          clearTimeout(timeout);
          resolve(null);
        }
      });
    }
  });

  await context.close();

  const cfg: AgentConfig = {
    deviceId,
    emailId: form.emailId,
    storeIds: form.storeIds,
    clientId: form.clientId,
    clientSecret: form.clientSecret,
    firstRunCompletedAt: new Date().toISOString(),
  };
  saveAgentConfig(cfg);
  console.log('[FIRST-RUN] Setup complete');
  return cfg;
}

/**
 * The sites to sign in to for the stores just entered, from a check-in.
 *
 * Credentials or stores the backend refuses abort the setup with the reason.
 * An unreachable backend falls back to this agent kind's default site with a
 * warning: the setup can still be saved, and the next cycle checks in anyway.
 */
async function sitesForStores(deviceId: string, form: SetupForm): Promise<string[]> {
  useServiceAccount({ clientId: form.clientId, clientSecret: form.clientSecret });
  let stores;
  try {
    const resp = await checkin({
      device_id: deviceId,
      agent_kind: config.agentKind,
      store_ids: form.storeIds,
      email: form.emailId,
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      agent_version: config.agentVersion,
    });
    stores = resp.stores;
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof AuthError) {
      throw new Error(`Setup incomplete: the service account was refused — ${message}`);
    }
    if (/^checkin 4\d\d/.test(message)) {
      throw new Error(
        `Setup incomplete: the backend refused these store IDs for a ${config.agentKind} ` +
          `agent — check them (${message})`,
      );
    }
    console.warn(
      `[FIRST-RUN] could not reach the backend (${message}) — signing in to ` +
        `${config.firstRunDomain} only; re-run setup later if your stores are elsewhere`,
    );
    return [config.firstRunDomain];
  }

  if (!stores || stores.length === 0) {
    console.warn('[FIRST-RUN] the backend did not say where the stores are — using the default site');
    return [config.firstRunDomain];
  }
  const { sites, unknown } = signInSites(stores);
  for (const store of stores) {
    console.log(`[FIRST-RUN] store ${store.store_id} → ${store.short_code}`);
  }
  if (unknown.length > 0) {
    console.warn(
      `[FIRST-RUN] no sign-in site known for ${unknown.join(', ')} — their scrapers will ` +
        'fail until src/sites.ts and the scrapers\' marketplaces.ts list them',
    );
  }
  return sites.length > 0 ? sites : [config.firstRunDomain];
}

// Capitalised marketplace name for the setup form's copy, so a Noon agent does
// not tell the employee to sign into Amazon.
const KIND_LABEL: Record<string, string> = {
  amazon: 'Amazon',
  flipkart: 'Flipkart',
  noon: 'noon',
};
const MARKETPLACE = KIND_LABEL[config.agentKind] ?? 'the marketplace';

const FORM_HTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: system-ui, Arial, sans-serif; background: #f3f4f6; margin: 0; padding: 40px; }
  .card { max-width: 460px; margin: 0 auto; background: #fff; border-radius: 12px;
          box-shadow: 0 6px 24px rgba(0,0,0,.08); padding: 28px 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: #6b7280; margin: 0 0 20px; font-size: 14px; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 16px 0 6px; }
  input, textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px;
                    border: 1px solid #d1d5db; border-radius: 8px; }
  textarea { min-height: 96px; resize: vertical; }
  button { margin-top: 22px; width: 100%; padding: 12px; font-size: 15px; font-weight: 600;
           color: #fff; background: #4f46e5; border: none; border-radius: 8px; cursor: pointer; }
  button:hover { background: #4338ca; }
  .hint { color: #9ca3af; font-size: 12px; margin-top: 4px; }
  .error { color: #dc2626; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
  <div class="card">
    <h1>VentaWiz Scraper Agent</h1>
    <p class="sub">One-time setup for this laptop.</p>
    <form id="f">
      <label for="email">Your work email</label>
      <input id="email" type="email" placeholder="you@domventas.com" required />
      <label for="stores">Store IDs</label>
      <textarea id="stores" placeholder="One per line, or comma-separated (digits only)"></textarea>
      <div class="hint">The VentaWiz store IDs you scrape for, e.g. 13, 132.</div>
      <label for="clientId">Client ID</label>
      <input id="clientId" type="text" placeholder="svc_…" autocomplete="off" spellcheck="false" />
      <label for="clientSecret">Client secret</label>
      <input id="clientSecret" type="password" placeholder="vws_…" autocomplete="off" spellcheck="false" />
      <div class="hint">The VentaWiz service account for this laptop, from your VentaWiz admin.
        The secret is shown to them only once, when the account is created.</div>
      <div class="error" id="err"></div>
      <button type="submit">Save &amp; continue to ${MARKETPLACE} login</button>
    </form>
  </div>
<script>
  document.getElementById('f').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = document.getElementById('err');
    err.textContent = '';
    var raw = document.getElementById('stores').value
      .split(/[\\n,]+/).map(function (v) { return v.trim(); })
      .filter(function (v) { return v.length > 0; });
    var bad = raw.filter(function (v) { return !/^[0-9]+$/.test(v) || Number(v) <= 0; });
    var emailId = document.getElementById('email').value;
    if (!emailId) {
      err.textContent = 'Please enter your email.';
      return;
    }
    if (bad.length > 0) {
      err.textContent = 'Store IDs must be whole numbers (digits only). Not valid: ' + bad.join(', ');
      return;
    }
    var storeIds = raw.map(Number).filter(function (n, i, all) { return all.indexOf(n) === i; });
    if (storeIds.length === 0) {
      err.textContent = 'Please enter at least one store ID.';
      return;
    }
    if (storeIds.length > ${MAX_STORE_IDS}) {
      err.textContent = 'At most ${MAX_STORE_IDS} store IDs per agent.';
      return;
    }
    var clientId = document.getElementById('clientId').value.trim();
    var clientSecret = document.getElementById('clientSecret').value.trim();
    if (clientId.indexOf('${CLIENT_ID_PREFIX}') !== 0) {
      err.textContent = 'The client ID starts with ${CLIENT_ID_PREFIX} — check what your admin sent you.';
      return;
    }
    if (clientSecret.indexOf('${CLIENT_SECRET_PREFIX}') !== 0) {
      err.textContent = 'The client secret starts with ${CLIENT_SECRET_PREFIX} — check what your admin sent you.';
      return;
    }
    await window.__saveAgentSetup({
      emailId: emailId,
      storeIds: storeIds,
      clientId: clientId,
      clientSecret: clientSecret,
    });
    document.querySelector('.card').innerHTML =
      '<h1>Thanks!</h1><p class="sub">Opening ${MARKETPLACE} — sign in, set your delivery address, then close that tab.</p>';
  });
</script>
</body>
</html>
`;
