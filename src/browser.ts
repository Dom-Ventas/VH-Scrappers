import * as fs from 'fs';
import { chromium, BrowserContext } from 'playwright';
import { config } from './config';

export async function openPersistentContext(): Promise<BrowserContext> {
  if (!fs.existsSync(config.profileDir)) {
    fs.mkdirSync(config.profileDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: false,
    channel: config.chromeChannel,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  context.setDefaultTimeout(config.navigationTimeoutMs);

  return context;
}
