import * as fs from 'fs';
import { chromium, BrowserContext } from 'playwright';
import { config } from './config';

export async function openPersistentContext(
  opts: {
    visible?: boolean;
  } = {}
): Promise<BrowserContext> {

  const { visible = false } = opts;

  console.log(
    `[BROWSER] headed (required by noon); window ${
      visible ? 'visible' : 'off-screen'
    }`
  );

  if (
    !fs.existsSync(
      config.profileDir
    )
  ) {

    fs.mkdirSync(
      config.profileDir,
      {
        recursive: true
      }
    );
  }

  // Noon (Akamai) blocks headless Chrome outright — its built-in user agent
  // says "HeadlessChrome" — so the browser always launches headed. When the run
  // is not meant to be watched the window is parked far off-screen instead,
  // which is what these coordinates are for.
  const windowArgs =
    visible
      ? ['--start-maximized']
      : [
          '--window-position=-32000,-32000',
          '--window-size=1920,1080'
        ];

  // No user-agent override on purpose. The Amazon scraper pins a Windows
  // Chrome 124 string because it ships as a Windows .exe; here that same string
  // contradicts the real platform and TLS fingerprint, and noon's Saudi
  // storefront rejects the mismatch (the UAE one tolerates it). Chrome's own
  // user agent always matches the machine it is running on.
  let context: BrowserContext;

  try {
    context = await chromium.launchPersistentContext(
      config.profileDir,
      {
        headless: false,

        channel: config.chromeChannel,

        viewport: { width: 1920, height: 1080 },

        args: [
          ...windowArgs,
          '--disable-blink-features=AutomationControlled'
        ]
      }
    );
  } catch (err) {
    console.log(
      '[BROWSER] System Chrome channel launch failed, using bundled browser fallback...'
    );

    context = await chromium.launchPersistentContext(
      config.profileDir,
      {
        headless: false,

        viewport: { width: 1920, height: 1080 },

        args: [
          ...windowArgs,
          '--disable-blink-features=AutomationControlled'
        ]
      }
    );
  }

  // tsx/esbuild compiles with keepNames, which rewrites functions passed to
  // page.evaluate() to call a `__name` helper that only exists in the bundler's
  // scope — every evaluate with an inner named function throws
  // "__name is not defined" in the page. Defining a no-op shim before any page
  // script runs makes evaluate callbacks work unchanged.
  await context.addInitScript({
    content:
      'window.__name = window.__name || function (fn) { return fn; };'
  });

  context.setDefaultNavigationTimeout(
    config.navigationTimeoutMs
  );

  context.setDefaultTimeout(
    config.navigationTimeoutMs
  );

  return context;
}
