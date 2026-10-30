import * as fs from 'fs';
import * as path from 'path';

import { parseStoreIds, userSettingsPath } from './config';
import { UserSettings } from './types';

export function loadUserSettings():
  | UserSettings
  | null {

  const filePath = userSettingsPath();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {

    const raw =
      fs.readFileSync(filePath, 'utf8');

    const parsed = JSON.parse(raw);

    if (!parsed.emailId) {
      return null;
    }

    // Only VentaWiz `storeIds` count. A legacy file holding just VentaHub
    // `profileIds` / `profileId` is treated as "no settings" — those ids are
    // not store ids — so a standalone run shows the first-run form again.
    if (!Array.isArray(parsed.storeIds)) {
      return null;
    }

    const storeIds =
      parseStoreIds(
        parsed.storeIds.join(','),
        'user-settings.json storeIds'
      );

    if (storeIds.length === 0) {
      return null;
    }

    return {
      emailId: parsed.emailId,

      storeIds,

      firstRunCompletedAt:
        parsed.firstRunCompletedAt ||
        new Date().toISOString()
    };

  } catch {

    return null;
  }
}

export function saveUserSettings(
  settings: UserSettings
): void {

  const filePath = userSettingsPath();

  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {

    fs.mkdirSync(dir, {
      recursive: true
    });
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(settings, null, 2),
    'utf8'
  );
}
