import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { parseStoreIds, saveUserSettings } from './userSettings';
import { UserSettings } from './types';
import { config } from './config';

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
    <h2>Flipkart Search Term Scrapper — First Launch</h2>
    <form id="f">
      <p><label>Email ID <input id="emailId" required /></label></p>
      <p><label>Store IDs (one per line or comma-separated, digits only) <textarea id="storeIds" rows="4" required></textarea></label></p>
      <p><button type="submit">Save</button></p>
      <p id="status"></p>
    </form>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await window.__saveUserSettings({
          emailId: document.getElementById('emailId').value.trim(),
          storeIds: document.getElementById('storeIds').value,
        });
        document.getElementById('status').textContent = res.ok ? 'Saved.' : res.error;
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

  // The page passes the store ids as typed; they are validated here so the
  // HTML form and the inline fallback share one rule, and the error goes back
  // to the page to show.
  await page.exposeFunction(
    '__saveUserSettings',
    (data: { emailId: string; storeIds: string }): { ok: boolean; error?: string } => {
      const emailId = String(data.emailId || '').trim();
      if (!emailId) return { ok: false, error: 'Please enter an Email ID.' };
      const parsed = parseStoreIds(String(data.storeIds || ''));
      if ('error' in parsed) return { ok: false, error: parsed.error };
      if (parsed.storeIds.length === 0) {
        return { ok: false, error: 'Please enter at least one Store ID.' };
      }
      const settings: UserSettings = {
        emailId,
        storeIds: parsed.storeIds,
        firstRunCompletedAt: new Date().toISOString(),
      };
      saveUserSettings(settings);
      console.log(
        `[FIRST-RUN] Settings saved: emailId="${settings.emailId}" storeIds=[${settings.storeIds.join(', ')}]`,
      );
      resolveSettings(settings);
      return { ok: true };
    },
  );

  await page.setContent(loadFirstRunHtml(), { waitUntil: 'domcontentloaded' });

  const settings = await settingsPromise;

  // After saving, open Flipkart so the user can log in + set the delivery
  // pincode in the same window. Signing in also stops the login modal from
  // covering the search grid on every later navigation.
  console.log(
    '[FIRST-RUN] Opening Flipkart. Please sign in and set your delivery pincode,',
  );
  console.log(
    '[FIRST-RUN] then close the Flipkart tab (or the window) to continue.',
  );
  await page.goto(`https://${config.defaultFlipkartDomain}`, {
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
