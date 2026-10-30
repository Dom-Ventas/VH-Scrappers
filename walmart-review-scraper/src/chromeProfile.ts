import { execFileSync } from 'child_process';
import * as path from 'path';
import { chromium, BrowserContext } from 'playwright';

type LaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Close Chrome processes still running on this profile from an earlier run.
 *
 * Chromium locks a persistent profile. The window is parked off-screen, so a
 * Chrome left behind by a crashed or interrupted run is invisible — and every
 * later launch on the same profile exits immediately with code 21 ("profile in
 * use"). Only processes whose command line names THIS profile directory are
 * touched; the user's own Chrome is left alone.
 */
async function releaseProfile(profileDir: string): Promise<void> {
  if (process.platform !== 'win32') return;

  const needle = path.resolve(profileDir).toLowerCase().replace(/'/g, "''");
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${needle}') } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;

  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true },
    );
    const killed = out.split(/\s+/).filter(Boolean).length;
    if (killed > 0) {
      console.log(`[BROWSER] closed ${killed} leftover Chrome process(es) holding the profile`);
      await sleep(2_000); // give Windows time to release the profile lock
    }
  } catch {
    // Best effort — if it fails, the launch below reports the real problem.
  }
}

/**
 * Launch installed Google Chrome on a persistent profile.
 *
 * There is deliberately NO fallback to Playwright's bundled Chromium: that
 * browser is not packed into the exe, so falling back only replaced the real
 * error with "run npx playwright install" — and installing it by hand fetches
 * whatever revision the latest Playwright wants, which never matches the one
 * compiled into the exe.
 */
export async function launchChrome(
  profileDir: string,
  options: LaunchOptions,
): Promise<BrowserContext> {
  await releaseProfile(profileDir);

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: options.channel ?? 'chrome',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/exitCode=21\b/.test(msg)) {
      throw new Error(
        `Chrome profile is in use by another Chrome process: ${profileDir}. ` +
          'Close it (or wait for the other run to finish) and try again.',
      );
    }
    if (/distribution '.*' is not found/i.test(msg)) {
      throw new Error('Google Chrome is not installed on this machine. Install Chrome and try again.');
    }
    throw err;
  }
}
