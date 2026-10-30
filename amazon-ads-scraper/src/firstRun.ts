import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { saveUserSettings } from './userSettings';
import { UserSettings } from './types';
import { config, parseStoreIds } from './config';

function loadFirstRunHtml(): string {
  const candidates = [
    path.join(__dirname, 'ui', 'first-run.html'),
    path.join(process.cwd(), 'src', 'ui', 'first-run.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return `<!doctype html><html><body>
    <h2>Search Term Scrapper — First Launch</h2>
    <form id="f">
      <p><label>Email ID <input id="emailId" required /></label></p>
      <p><label>Store IDs (one per line or comma-separated, digits only) <textarea id="storeIds" rows="4" required></textarea></label></p>
      <p id="err" style="color:#b42318"></p>
      <p><button type="submit">Save</button></p>
    </form>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tokens = document.getElementById('storeIds').value
          .split(/[\\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const bad = tokens.filter((t) => !/^[0-9]+$/.test(t) || Number(t) <= 0);
        const err = document.getElementById('err');
        if (tokens.length === 0 || bad.length > 0) {
          err.textContent = bad.length
            ? 'Store IDs must be whole numbers. Not valid: ' + bad.join(', ')
            : 'Enter at least one Store ID.';
          return;
        }
        err.textContent = '';
        await window.__saveUserSettings({
          emailId: document.getElementById('emailId').value.trim(),
          storeIds: tokens,
        });
      });
    </script>
  </body></html>`;
}

export async function runFirstLaunchFlow(page: Page): Promise<UserSettings> {
  console.log('[FIRST-RUN] No saved settings found. Showing onboarding form...');

  let resolveSettings!: (s: UserSettings) => void;
  const settingsPromise = new Promise<UserSettings>((resolve) => {
    resolveSettings = resolve;
  });

  await page.exposeFunction(
    '__saveUserSettings',
    (data: { emailId: string; storeIds: Array<string | number> }) => {
      const { ids: storeIds, invalid } = parseStoreIds(data.storeIds || []);
      if (invalid.length > 0) {
        // The form validates too; this guards a hand-edited page.
        throw new Error(`Store IDs must be whole numbers. Not valid: ${invalid.join(', ')}`);
      }
      if (storeIds.length === 0) {
        throw new Error('Enter at least one Store ID.');
      }
      const settings: UserSettings = {
        emailId: data.emailId,
        storeIds,
        firstRunCompletedAt: new Date().toISOString(),
      };
      saveUserSettings(settings);
      console.log(
        `[FIRST-RUN] Settings saved: emailId="${settings.emailId}" storeIds=[${settings.storeIds.join(', ')}]`,
      );
      resolveSettings(settings);
    },
  );

  await page.setContent(loadFirstRunHtml(), { waitUntil: 'domcontentloaded' });

  const settings = await settingsPromise;

  // After saving, open Amazon so the user can log in + set pincode in the same window.
  console.log(
    '[FIRST-RUN] Opening Amazon. Please sign in and set your delivery pincode,',
  );
  console.log(
    '[FIRST-RUN] then close the Amazon tab (or the window) to continue.',
  );
  await page.goto(`https://${config.defaultAmazonDomain}`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the user to close the page (signals "I'm done logging in")
  // or for a max timeout of 10 minutes.
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[FIRST-RUN] 10 minute login window elapsed — continuing.');
      resolve();
    }, 10 * 60 * 1000);

    page.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return settings;
}
