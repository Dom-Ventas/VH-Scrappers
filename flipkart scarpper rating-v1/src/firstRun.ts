import {
  Page,
  BrowserContext
} from 'playwright';

import { extractPincodeApplied } from './extractors';

import {
  saveUserSettings
} from './userSettings';

import {
  UserSettings
} from './types';

import {
  config
} from './config';

/**
 * The delivery pincode is NOT collected on this form. It is set by the user
 * directly on Flipkart, in the same browser session as the login, because
 * that is the only place it can take effect: "Select delivery location" is a
 * div with no input behind it, Flipkart's React-Native-Web layer ignores
 * synthetic click events, and the value cannot be injected either — there is no
 * pincode cookie or localStorage key, Flipkart binds the location to the
 * server-side session.
 *
 * A pincode typed into this form would therefore be a value we could store but
 * never apply. The login and the pincode are one manual step, and both persist
 * in the Chrome profile for later headless runs.
 */
/**
 * Prints the manual steps and waits for the user to finish, then reads back
 * whether the delivery location actually took effect.
 *
 * The read-back matters: the pincode lives in Flipkart's server-side session
 * behind the persistent Chrome profile, and nothing guarantees it survives.
 * Without this, a setup that silently failed looks identical to one that
 * worked, and every later run quietly reports geo-guessed delivery dates.
 */
export async function runLoginAndPincodeFlow(
  context: BrowserContext
): Promise<boolean | null> {

  const page = await context.newPage();

  await page.goto(
    `https://${config.defaultFlipkartDomain}`,
    {
      waitUntil: 'domcontentloaded'
    }
  );

  console.log('');
  console.log('[SETUP] In the browser window, please:');
  console.log('[SETUP]   1. Log in to your Flipkart account.');
  console.log(
    '[SETUP]   2. Set your delivery pincode using "Select delivery ' +
      'location" on any product page.'
  );
  console.log('[SETUP]   3. Close the browser tab when done.');
  console.log('');
  console.log(
    '[SETUP] Both are saved in the browser profile and reused on later runs.'
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

  console.log('');
  console.log('[SETUP] Checking whether the delivery location stuck...');

  const checkPage = await context.newPage();

  let applied: boolean | null = null;

  try {

    await checkPage.goto(
      `https://${config.defaultFlipkartDomain}/product/p/itme?pid=${config.pincodeCheckPid}`,
      {
        waitUntil: 'domcontentloaded'
      }
    );

    applied = await extractPincodeApplied(checkPage);

  } catch (err) {

    console.warn('[SETUP] Could not load the check page', err);

  } finally {

    await checkPage.close().catch(() => {});
  }

  if (applied === true) {
    console.log('[SETUP] OK — a delivery location is set and will be reused.');
  } else if (applied === false) {
    console.warn(
      '[SETUP] Flipkart still reports "Location not set". The pincode did not\n' +
        '[SETUP] stick — delivery promises will be geo-guessed. Re-run\n' +
        '[SETUP] `npm run setup` and set it on a product page before closing.'
    );
  } else {
    console.warn(
      '[SETUP] Could not tell — the check page did not render a delivery\n' +
        '[SETUP] section. Try `npm run setup` again.'
    );
  }

  return applied;
}

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
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Flipkart Review Scraper — Setup</title>
<style>
  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 40px 20px;
    background: #f1f3f6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #212121;
    line-height: 1.5;
  }

  .card {
    max-width: 560px;
    margin: 0 auto;
    background: #fff;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,.12);
    overflow: hidden;
  }

  header {
    background: #2874f0;
    color: #fff;
    padding: 22px 28px;
  }

  header h1 { margin: 0; font-size: 20px; font-weight: 600; }
  header p  { margin: 4px 0 0; font-size: 13px; opacity: .9; }

  .body { padding: 28px; }

  label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .4px;
    color: #878787;
    margin-bottom: 6px;
  }

  input, textarea {
    width: 100%;
    padding: 11px 12px;
    font-size: 14px;
    font-family: inherit;
    border: 1px solid #dbdbdb;
    border-radius: 3px;
    background: #fff;
    color: #212121;
  }

  input:focus, textarea:focus { outline: none; border-color: #2874f0; }

  textarea { resize: vertical; min-height: 96px; }

  .hint { font-size: 12px; color: #878787; margin: 6px 0 0; }

  .field { margin-bottom: 22px; }

  button {
    width: 100%;
    padding: 13px;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    color: #fff;
    background: #fb641b;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
  }

  button:hover { background: #e85b16; }

  .next {
    margin: 26px 0 0;
    padding: 18px 20px;
    background: #f8f9fb;
    border-left: 3px solid #2874f0;
    border-radius: 3px;
  }

  .next h2 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
  .next ol { margin: 0; padding-left: 20px; font-size: 13px; }
  .next li { margin-bottom: 6px; }
  .next p  { margin: 12px 0 0; font-size: 12px; color: #878787; }
</style>
</head>
<body>

<div class="card">

<header>
<h1>Flipkart Review Scraper</h1>
<p>First-time setup</p>
</header>

<div class="body">

<form id="f">

<div class="field">
<label for="email">Email</label>
<input id="email" type="email" placeholder="you@company.com" autocomplete="off"/>
</div>

<div class="field">
<label for="profiles">Profile IDs</label>
<textarea id="profiles" placeholder="One per line, or comma separated"></textarea>
<p class="hint">The scraper fetches a product list for each profile ID.</p>
</div>

<button type="submit">Save and continue</button>

</form>

<div class="next">
<h2>What happens next</h2>
<ol>
<li>Flipkart opens in this same window.</li>
<li>Log in to your Flipkart account.</li>
<li>
Set your <b>delivery pincode</b> using
&ldquo;Select delivery location&rdquo; on any product page.
</li>
<li>Close the browser tab when both are done.</li>
</ol>
<p>
Both are saved in this browser profile and reused automatically on later
runs. The pincode has to be set on Flipkart itself &mdash; it only takes
effect there, which is why it is not a field on this form.
</p>
</div>

</div>
</div>

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
    '[FIRST-RUN] Opening Flipkart'
  );

  await page.goto(
    `https://${config.defaultFlipkartDomain}`,
    {
      waitUntil:
        'domcontentloaded'
    }
  );

  console.log('');
  console.log('[FIRST-RUN] In the browser window, please:');
  console.log('[FIRST-RUN]   1. Log in to your Flipkart account.');
  console.log(
    '[FIRST-RUN]   2. Set your delivery pincode using "Select delivery ' +
      'location" on any product page.'
  );
  console.log('[FIRST-RUN]   3. Close the browser tab when done.');
  console.log('');
  console.log(
    '[FIRST-RUN] Both are saved in the browser profile and reused on later runs.'
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
