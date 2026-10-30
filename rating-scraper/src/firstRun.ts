import {
  Page
} from 'playwright';

import {
  saveUserSettings
} from './userSettings';

import {
  UserSettings
} from './types';

import {
  config,
  parseStoreIds
} from './config';

export async function runFirstLaunchFlow(
  page: Page
): Promise<UserSettings> {
  console.log(
    '[FIRST-RUN] No settings found'
  );

  let resolver!: (
    settings: UserSettings
  ) => void;

  const settingsPromise =
    new Promise<UserSettings>(
      resolve => {
        resolver = resolve;
      }
    );

  await page.exposeFunction(
    '__saveUserSettings',
    async (
      data: {
        emailId: string;
        storeIds: Array<string | number>;
      }
    ) => {
      const {
        ids: storeIds,
        invalid
      } = parseStoreIds(
        data.storeIds || []
      );

      // The form validates too; this guards a hand-edited page.
      if (invalid.length > 0) {
        throw new Error(
          `Store IDs must be whole numbers. Not valid: ${invalid.join(', ')}`
        );
      }

      if (storeIds.length === 0) {
        throw new Error(
          'Enter at least one Store ID.'
        );
      }

      const settings: UserSettings =
        {
          emailId:
            data.emailId.trim(),

          storeIds,

          firstRunCompletedAt:
            new Date().toISOString()
        };

      saveUserSettings(
        settings
      );

      console.log(
        `[FIRST-RUN] Settings saved: storeIds=[${storeIds.join(', ')}]`
      );

      resolver(settings);
    }
  );

  await page.setContent(`
<html>
<body>
<h2>Amazon Review Scraper</h2>

<form id="f">

<label>Email</label>
<br/>
<input id="email"/>

<br/><br/>

<label>Store IDs (one per line or comma-separated, digits only)</label>
<br/>

<textarea
 id="stores"
 rows="6"
 cols="50">
</textarea>

<p id="err" style="color:#b42318"></p>

<button type="submit">
Save
</button>

</form>

<script>

document
.getElementById('f')
.addEventListener(
 'submit',
 async e => {

e.preventDefault();

const storeIds =
document
.getElementById('stores')
.value
.split(/[\\n,]+/)
.map(v => v.trim())
.filter(Boolean);

const err =
document.getElementById('err');

const bad =
storeIds.filter(
 v => !/^[0-9]+$/.test(v) || Number(v) <= 0
);

if (storeIds.length === 0 || bad.length > 0) {
err.textContent = bad.length
 ? 'Store IDs must be whole numbers. Not valid: ' + bad.join(', ')
 : 'Enter at least one Store ID.';
return;
}

err.textContent = '';

try {
await window
.__saveUserSettings({
emailId:
document
.getElementById('email')
.value,
storeIds
});
} catch (ex) {
err.textContent =
 'Failed to save: ' + (ex && ex.message ? ex.message : String(ex));
}
});
</script>

</body>
</html>
`);

  const settings =
    await settingsPromise;

  console.log(
    '[FIRST-RUN] Opening Amazon login page'
  );

  await page.goto(
    `https://${config.defaultAmazonDomain}`,
    {
      waitUntil:
        'domcontentloaded'
    }
  );

  console.log(
    '[FIRST-RUN] Login to Amazon and close the browser tab'
  );

  await new Promise(
    resolve => {
      const timeout =
        setTimeout(
          resolve,
          10 *
            60 *
            1000
        );

      page.once(
        'close',
        () => {
          clearTimeout(
            timeout
          );
          resolve(null);
        }
      );
    }
  );

  return settings;
}