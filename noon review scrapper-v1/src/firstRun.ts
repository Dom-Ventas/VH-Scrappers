import { Page } from 'playwright';

import { saveUserSettings } from './userSettings';
import { UserSettings } from './types';
import { config } from './config';

export async function runFirstLaunchFlow(
  page: Page
): Promise<UserSettings> {

  console.log('[FIRST-RUN] No settings found');

  let resolver!: (settings: UserSettings) => void;

  const settingsPromise =
    new Promise<UserSettings>(resolve => {
      resolver = resolve;
    });

  await page.exposeFunction(
    '__saveUserSettings',
    async (data: {
      emailId: string;
      storeIds: Array<string | number>;
    }) => {

      const tokens =
        (data.storeIds || [])
          .map(v => String(v).trim())
          .filter(Boolean);

      const bad =
        tokens.filter(t => !/^\d+$/.test(t) || Number(t) <= 0);

      if (tokens.length === 0 || bad.length > 0) {

        // Thrown back into the page, which shows it under the form.
        throw new Error(
          bad.length
            ? `Store IDs must be whole numbers. Not valid: ${bad.join(', ')}`
            : 'Enter at least one Store ID.'
        );
      }

      const settings: UserSettings = {
        emailId: data.emailId.trim(),

        storeIds: [...new Set(tokens.map(Number))],

        firstRunCompletedAt:
          new Date().toISOString()
      };

      saveUserSettings(settings);

      console.log(
        `[FIRST-RUN] Settings saved: storeIds=[${settings.storeIds.join(', ')}]`
      );

      resolver(settings);
    }
  );

  await page.setContent(`
<html>
<body style="font-family: system-ui, sans-serif; max-width: 520px; margin: 40px auto;">

<h2>Noon Review Scraper</h2>
<p>First-time setup. These are stored in your scraper profile folder.</p>

<form id="f">

<label>Email</label>
<br/>
<input id="email" style="width: 100%; padding: 6px;" />

<br/><br/>

<label>Store IDs (one per line, or comma separated — digits only)</label>
<br/>
<textarea id="storeIds" rows="6" style="width: 100%; padding: 6px;"></textarea>

<br/><br/>

<button type="submit" style="padding: 8px 18px;">Save</button>

<p id="status" style="color: #b42318;"></p>

</form>

<script>
document
  .getElementById('f')
  .addEventListener('submit', async function (e) {

    e.preventDefault();

    var status = document.getElementById('status');

    var storeIds = document
      .getElementById('storeIds')
      .value
      .split(/[\\s,]+/)
      .map(function (v) { return v.trim(); })
      .filter(Boolean);

    var bad = storeIds.filter(function (v) {
      return !/^[0-9]+$/.test(v) || Number(v) <= 0;
    });

    if (storeIds.length === 0 || bad.length > 0) {
      status.textContent = bad.length
        ? 'Store IDs must be whole numbers (digits only). Not valid: ' + bad.join(', ')
        : 'Enter at least one Store ID.';
      return;
    }

    try {
      await window.__saveUserSettings({
        emailId: document.getElementById('email').value,
        storeIds: storeIds
      });
      status.textContent = '';
    } catch (err) {
      status.textContent =
        'Failed to save: ' + (err && err.message ? err.message : String(err));
    }
  });
</script>

</body>
</html>
`);

  const settings = await settingsPromise;

  console.log('[FIRST-RUN] Opening Noon');

  await page.goto(
    `https://${config.defaultNoonLocale}`,
    { waitUntil: 'domcontentloaded' }
  );

  console.log(
    '[FIRST-RUN] Log in to Noon if you need to, then close this tab to continue'
  );

  await new Promise(resolve => {

    const timeout =
      setTimeout(resolve, 10 * 60 * 1000);

    page.once('close', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });

  return settings;
}
