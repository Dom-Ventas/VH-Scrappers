import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright';
import { saveUserSettings } from './userSettings';
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
    <h2>Walmart Review Scrapper — First Launch</h2>
    <form id="f">
      <p><label>Email ID <input id="emailId" required /></label></p>
      <p><label>Store IDs (one per line or comma-separated, digits only) <textarea id="storeIds" rows="4" required></textarea></label></p>
      <p><button type="submit">Save</button></p>
      <p id="status"></p>
    </form>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const storeIds = document.getElementById('storeIds').value
          .split(/[\\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const bad = storeIds.filter((s) => !/^[0-9]+$/.test(s) || Number(s) <= 0);
        const status = document.getElementById('status');
        if (storeIds.length === 0 || bad.length > 0) {
          status.textContent = bad.length
            ? 'Store IDs must be whole numbers. Not valid: ' + bad.join(', ')
            : 'Enter at least one Store ID.';
          return;
        }
        try {
          await window.__saveUserSettings({
            emailId: document.getElementById('emailId').value.trim(),
            storeIds,
          });
        } catch (err) {
          status.textContent = 'Failed to save: ' + (err && err.message ? err.message : String(err));
        }
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
      const tokens = (data.storeIds || []).map((p) => String(p).trim()).filter(Boolean);
      const bad = tokens.filter((t) => !/^\d+$/.test(t) || Number(t) <= 0);
      if (tokens.length === 0 || bad.length > 0) {
        // Thrown back into the page, which shows the message under the form.
        const msg = bad.length
          ? `Store IDs must be whole numbers. Not valid: ${bad.join(', ')}`
          : 'Enter at least one Store ID.';
        console.warn(`[FIRST-RUN] ${msg} — ignoring submission.`);
        throw new Error(msg);
      }
      const storeIds = [...new Set(tokens.map(Number))];
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

  // After saving, open Walmart so the user can set the delivery location in
  // the same window. Walmart needs no account to search, but the delivery
  // promise on the grid depends on the store/ZIP picked in the header
  // ("Pickup or delivery?"), and that choice — plus any "Robot or human?"
  // check passed here — is what the persistent Chrome profile carries into
  // the later, off-screen runs.
  console.log(
    '[FIRST-RUN] Opening Walmart. Please set your delivery ZIP / store (sign in if you like),',
  );
  console.log(
    '[FIRST-RUN] complete any "Robot or human?" check, then close the Walmart tab (or the window) to continue.',
  );
  await page.goto(`https://${config.defaultWalmartDomain}/`, {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the user to close the page (signals "I'm done")
  // or for a max timeout of 10 minutes.
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[FIRST-RUN] 10 minute setup window elapsed — continuing.');
      resolve();
    }, 10 * 60 * 1000);

    page.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  return settings;
}
