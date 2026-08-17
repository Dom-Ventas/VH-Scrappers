import * as fs from 'fs';
import { chromium, BrowserContext } from 'playwright';
import { config } from './config';

export async function openPersistentContext(
  opts: {
    visible?: boolean;
  } = {}
): Promise<BrowserContext> {

  const { visible = false } =
    opts;

  console.log(
    `[BROWSER] visible=${visible}`
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

  const windowArgs =
    visible
      ? ['--start-maximized']
      : [
          '--window-position=-32000,-32000',
          '--window-size=1920,1080'
        ];

  const desktopUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  let context: BrowserContext;

  try {
    context = await chromium.launchPersistentContext(
      config.profileDir,
      {
        headless: !visible,

        channel:
          config.chromeChannel,

        viewport: { width: 1920, height: 1080 },

        userAgent: desktopUserAgent,

        args: [
          ...windowArgs,
          '--disable-blink-features=AutomationControlled'
        ]
      }
    );
  } catch (err) {
    console.log('[BROWSER] System Chrome channel launch failed, using bundled browser fallback...');
    context = await chromium.launchPersistentContext(
      config.profileDir,
      {
        headless: !visible,

        viewport: { width: 1920, height: 1080 },

        userAgent: desktopUserAgent,

        args: [
          ...windowArgs,
          '--disable-blink-features=AutomationControlled'
        ]
      }
    );
  }

  context.setDefaultNavigationTimeout(
    config.navigationTimeoutMs
  );

  context.setDefaultTimeout(
    config.navigationTimeoutMs
  );

  return context;
}