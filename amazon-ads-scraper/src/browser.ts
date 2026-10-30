import * as fs from 'fs';
import { BrowserContext } from 'playwright';
import { launchChrome } from './chromeProfile';
import { config } from './config';

export interface OpenContextOpts {
  /**
   * If true, the Chrome window is shown maximized on-screen. If false, it
   * launches off-screen at (-32000, -32000) so the user can keep working in
   * other windows while the scraper runs. Off-screen Chrome is still a real,
   * fully-rendered browser — Amazon sees a normal session, not a headless
   * one — so price/delivery extraction is unaffected.
   */
  visible?: boolean;
}

export async function openPersistentContext(
  opts: OpenContextOpts = {},
): Promise<BrowserContext> {
  const { visible = false } = opts;

  if (!fs.existsSync(config.profileDir)) {
    fs.mkdirSync(config.profileDir, { recursive: true });
  }

  const windowArgs = visible
    ? ['--start-maximized']
    : ['--window-position=-32000,-32000', '--window-size=1920,1080'];

  const context = await launchChrome(config.profileDir, {
    headless: false,
    channel: config.chromeChannel,
    // Pinned rather than `null` (which inherits the OS window size and gave a
    // 1280-wide page here). Width changes how many banner slots and grid
    // columns Amazon renders, so it must be deterministic.
    viewport: { width: config.viewportWidth, height: config.viewportHeight },
    args: [...windowArgs, '--disable-blink-features=AutomationControlled'],
  });

  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  context.setDefaultTimeout(config.navigationTimeoutMs);

  return context;
}
