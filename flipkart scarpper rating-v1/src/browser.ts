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

  /**
   * Headless has no real window, so pin a known desktop viewport to keep
   * scraping deterministic.
   *
   * Visible mode must NOT pin one. Passing an explicit viewport turns on
   * Chrome's device-metrics override, which forces the page to that width and
   * drops devicePixelRatio to 1 — so on a maximized 1280pt Retina window the
   * page renders as a scaled-down, non-Retina 1920px layout. `null` lets the
   * page follow the actual window, which is what --start-maximized is for.
   */
  const viewport =
    visible
      ? null
      : { width: 1920, height: 1080 };

  let context: BrowserContext;

  try {
    context = await chromium.launchPersistentContext(
      config.profileDir,
      {
        headless: !visible,

        channel:
          config.chromeChannel,

        viewport,

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

        viewport,

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
