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

  const context =
    await chromium.launchPersistentContext(
      config.profileDir,
      {
        headless: !visible,

        channel:
          config.chromeChannel,

        viewport: null,

        args: [
          ...windowArgs,
          '--disable-blink-features=AutomationControlled'
        ]
      }
    );

  context.setDefaultNavigationTimeout(
    config.navigationTimeoutMs
  );

  context.setDefaultTimeout(
    config.navigationTimeoutMs
  );

  return context;
}