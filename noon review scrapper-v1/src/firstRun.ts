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
      profileIds: string[];
    }) => {

      const settings: UserSettings = {
        emailId: data.emailId.trim(),

        profileIds:
          data.profileIds
            .map(v => v.trim())
            .filter(Boolean),

        firstRunCompletedAt:
          new Date().toISOString()
      };

      saveUserSettings(settings);

      console.log('[FIRST-RUN] Settings saved');

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

<label>Profile IDs (one per line, or comma separated)</label>
<br/>
<textarea id="profiles" rows="6" style="width: 100%; padding: 6px;"></textarea>

<br/><br/>

<button type="submit" style="padding: 8px 18px;">Save</button>

</form>

<script>
document
  .getElementById('f')
  .addEventListener('submit', async function (e) {

    e.preventDefault();

    var profileIds = document
      .getElementById('profiles')
      .value
      .split(/[\\n,]+/)
      .map(function (v) { return v.trim(); })
      .filter(Boolean);

    await window.__saveUserSettings({
      emailId: document.getElementById('email').value,
      profileIds: profileIds
    });
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
