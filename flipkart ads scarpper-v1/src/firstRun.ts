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
    <h2>Flipkart Search Term Scrapper — First Launch</h2>
    <form id="f">
      <p><label>Email ID <input id="emailId" required /></label></p>
      <p><label>Profile IDs (one per line) <textarea id="profileIds" rows="4" required></textarea></label></p>
      <p><button type="submit">Save</button></p>
    </form>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const profileIds = document.getElementById('profileIds').value
          .split(/[\\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        await window.__saveUserSettings({
          emailId: document.getElementById('emailId').value.trim(),
          profileIds,
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
    (data: { emailId: string; profileIds: string[] }) => {
      const profileIds = (data.profileIds || [])
        .map((p) => String(p).trim())
        .filter(Boolean);
      if (profileIds.length === 0) {
        console.warn('[FIRST-RUN] No profile IDs provided — ignoring submission.');
        return;
      }
      const settings: UserSettings = {
        emailId: data.emailId,
        profileIds,
        firstRunCompletedAt: new Date().toISOString(),
      };
      saveUserSettings(settings);
      console.log(
        `[FIRST-RUN] Settings saved: emailId="${settings.emailId}" profileIds=[${settings.profileIds.join(', ')}]`,
      );
      resolveSettings(settings);
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
