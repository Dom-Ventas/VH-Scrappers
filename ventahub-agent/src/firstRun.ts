import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { config } from './config';
import { AgentConfig } from './types';
import { getOrCreateDeviceId } from './deviceId';

export function loadAgentConfig(): AgentConfig | null {
  try {
    if (!fs.existsSync(config.configPath)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(config.configPath, 'utf-8'),
    ) as Partial<AgentConfig>;
    if (
      !parsed.emailId ||
      !Array.isArray(parsed.profileIds) ||
      parsed.profileIds.length === 0
    ) {
      return null;
    }
    return {
      deviceId: parsed.deviceId || getOrCreateDeviceId(config.home),
      emailId: parsed.emailId,
      profileIds: parsed.profileIds.map((p) => String(p).trim()).filter(Boolean),
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
 * First-time setup: collect the employee's email + AMS profile IDs, then open
 * Amazon on the shared Chrome profile for a one-time sign-in. Every scraper
 * reuses this same profile, so the login happens exactly once per laptop.
 */
export async function runFirstLaunch(): Promise<AgentConfig> {
  console.log('[FIRST-RUN] No agent config found — starting setup');

  fs.mkdirSync(config.chromeProfileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(config.chromeProfileDir, {
    headless: false,
    channel: config.chromeChannel,
    viewport: null,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  const page = await context.newPage();

  let resolver!: (v: { emailId: string; profileIds: string[] }) => void;
  const formPromise = new Promise<{ emailId: string; profileIds: string[] }>(
    (resolve) => {
      resolver = resolve;
    },
  );

  await page.exposeFunction(
    '__saveAgentSetup',
    async (data: { emailId: string; profileIds: string[] }) => {
      resolver({
        emailId: (data.emailId || '').trim(),
        profileIds: (data.profileIds || [])
          .map((p) => String(p).trim())
          .filter(Boolean),
      });
    },
  );

  await page.setContent(FORM_HTML);

  const form = await formPromise;
  if (!form.emailId || form.profileIds.length === 0) {
    await context.close();
    throw new Error('Setup incomplete: email and at least one profile ID are required');
  }

  console.log(
    '[FIRST-RUN] Sign in to Amazon and set your delivery pincode, then close the tab',
  );
  await page.goto(`https://${config.defaultAmazonDomain}`, {
    waitUntil: 'domcontentloaded',
  });

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10 * 60 * 1000);
    page.once('close', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });

  await context.close();

  const cfg: AgentConfig = {
    deviceId: getOrCreateDeviceId(config.home),
    emailId: form.emailId,
    profileIds: form.profileIds,
    firstRunCompletedAt: new Date().toISOString(),
  };
  saveAgentConfig(cfg);
  console.log('[FIRST-RUN] Setup complete');
  return cfg;
}

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
</style>
</head>
<body>
  <div class="card">
    <h1>VentaHub Scraper Agent</h1>
    <p class="sub">One-time setup for this laptop.</p>
    <form id="f">
      <label for="email">Your work email</label>
      <input id="email" type="email" placeholder="you@domventas.com" required />
      <label for="profiles">AMS Profile IDs</label>
      <textarea id="profiles" placeholder="One per line, or comma-separated"></textarea>
      <div class="hint">These identify the Amazon advertiser accounts you scrape for.</div>
      <button type="submit">Save & continue to Amazon login</button>
    </form>
  </div>
<script>
  document.getElementById('f').addEventListener('submit', async function (e) {
    e.preventDefault();
    var profileIds = document.getElementById('profiles').value
      .split(/[\\n,]+/).map(function (v) { return v.trim(); })
      .filter(function (v) { return v.length > 0; });
    var emailId = document.getElementById('email').value;
    if (!emailId || profileIds.length === 0) {
      alert('Please enter your email and at least one profile ID.');
      return;
    }
    await window.__saveAgentSetup({ emailId: emailId, profileIds: profileIds });
    document.querySelector('.card').innerHTML =
      '<h1>Thanks!</h1><p class="sub">Opening Amazon — sign in, set your delivery pincode, then close that tab.</p>';
  });
</script>
</body>
</html>
`;
