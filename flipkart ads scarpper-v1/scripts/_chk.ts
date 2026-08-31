import { chromium } from 'playwright';
const SP = process.env.SP!;
async function tryLaunch(label: string, opts: any) {
  try {
    const ctx = await chromium.launchPersistentContext(opts.dir, {
      headless: false, viewport: null, channel: opts.channel,
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    });
    const page = await ctx.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    console.log(`${label}: OK — title="${await page.title()}"`);
    await ctx.close();
  } catch (e: any) {
    console.log(`${label}: FAILED — ${String(e.message).split('\n')[0]}`);
  }
}
(async () => {
  await tryLaunch("channel:'chrome' (real Chrome)", { dir: SP + '/c1', channel: 'chrome' });
  await tryLaunch('bundled chromium        ', { dir: SP + '/c2', channel: undefined });
})();
