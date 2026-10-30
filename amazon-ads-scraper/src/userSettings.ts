import * as fs from 'fs';
import * as path from 'path';
import { userSettingsPath, parseStoreIds } from './config';
import { UserSettings } from './types';

export function loadUserSettings(): UserSettings | null {
  const filePath = userSettingsPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    if (!parsed.emailId) return null;

    // Only `storeIds` counts. A legacy VentaHub file with just `profileIds` /
    // `profileId` is treated as "no settings": those were AMS profile ids, not
    // VentaWiz store ids, so a standalone run shows the first-run form again.
    if (!Array.isArray(parsed.storeIds)) return null;
    const { ids: storeIds } = parseStoreIds(parsed.storeIds);
    if (storeIds.length === 0) return null;

    return {
      emailId: parsed.emailId,
      storeIds,
      firstRunCompletedAt: parsed.firstRunCompletedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveUserSettings(settings: UserSettings): void {
  const filePath = userSettingsPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}
