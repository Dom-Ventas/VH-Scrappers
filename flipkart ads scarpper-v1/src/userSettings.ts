import * as fs from 'fs';
import * as path from 'path';
import { config, userSettingsPath } from './config';
import { UserSettings } from './types';

/**
 * Parse store ids typed by a person or passed in SCRAPE_STORE_IDS: one per
 * line or comma-separated, digits only. Returns the ids, or an error message
 * naming the first entry that is not a positive integer.
 */
export function parseStoreIds(raw: string): { storeIds: number[] } | { error: string } {
  const parts = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const storeIds: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!/^\d+$/.test(part) || !Number.isSafeInteger(n) || n <= 0) {
      return { error: `"${part}" is not a store ID — store IDs are whole numbers, e.g. 13` };
    }
    if (!storeIds.includes(n)) storeIds.push(n);
  }
  return { storeIds };
}

export function loadUserSettings(): UserSettings | null {
  const filePath = userSettingsPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    if (!parsed.emailId) return null;

    // Only `storeIds` counts. A legacy VentaHub file with `profileIds` reads as
    // "no settings": profile ids are not store ids, so the first-run form has
    // to be shown again to collect the real ones.
    if (!Array.isArray(parsed.storeIds)) return null;
    const result = parseStoreIds(parsed.storeIds.map(String).join(','));
    if ('error' in result || result.storeIds.length === 0) return null;

    return {
      emailId: parsed.emailId,
      storeIds: result.storeIds,
      firstRunCompletedAt: parsed.firstRunCompletedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Store ids to scrape: SCRAPE_STORE_IDS when set (the agent passes it), else
 * the ids saved at first run. Throws on a malformed SCRAPE_STORE_IDS rather
 * than silently scraping the wrong stores.
 */
export function resolveStoreIds(settings: UserSettings | null): number[] {
  if (config.storeIdsEnv) {
    const result = parseStoreIds(config.storeIdsEnv);
    if ('error' in result) throw new Error(`SCRAPE_STORE_IDS: ${result.error}`);
    return result.storeIds;
  }
  return settings?.storeIds ?? [];
}

export function saveUserSettings(settings: UserSettings): void {
  const filePath = userSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}
