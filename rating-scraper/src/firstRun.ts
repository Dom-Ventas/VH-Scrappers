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
  config
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
        profileIds: string[];
      }
    ) => {
      const settings: UserSettings =
        {
          emailId:
            data.emailId.trim(),

          profileIds:
            data.profileIds
              .map(v =>
                v.trim()
              )
              .filter(Boolean),

          firstRunCompletedAt:
            new Date().toISOString()
        };

      saveUserSettings(
        settings
      );

      console.log(
        '[FIRST-RUN] Settings saved'
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

<label>Profile IDs</label>
<br/>

<textarea
 id="profiles"
 rows="6"
 cols="50">
</textarea>

<br/><br/>

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

const profileIds =
document
.getElementById('profiles')
.value
.split(/[\\n,]+/)
.map(v => v.trim())
.filter(Boolean);

await window
.__saveUserSettings({
emailId:
document
.getElementById('email')
.value,
profileIds
});
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