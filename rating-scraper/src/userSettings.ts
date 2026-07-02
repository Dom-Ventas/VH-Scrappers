import * as fs from 'fs';
import * as path from 'path';

import {
  userSettingsPath
} from './config';

import {
  UserSettings
} from './types';

export function loadUserSettings():
  | UserSettings
  | null {

  const filePath =
    userSettingsPath();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {

    const raw =
      fs.readFileSync(
        filePath,
        'utf8'
      );

    const parsed =
      JSON.parse(raw);

    if (
      !parsed.emailId
    ) {
      return null;
    }

    let profileIds:
      string[] = [];

    // New format
    if (
      Array.isArray(
        parsed.profileIds
      )
    ) {

      profileIds =
        parsed.profileIds
          .map((p: any) =>
            String(p).trim()
          )
          .filter(Boolean);
    }

    // Legacy format
    else if (
      typeof parsed.profileId ===
      'string'
    ) {

      profileIds = [
        parsed.profileId.trim()
      ];
    }

    if (
      profileIds.length === 0
    ) {
      return null;
    }

    return {
      emailId:
        parsed.emailId,

      profileIds,

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

  const filePath =
    userSettingsPath();

  const dir =
    path.dirname(
      filePath
    );

  if (
    !fs.existsSync(dir)
  ) {

    fs.mkdirSync(
      dir,
      {
        recursive: true
      }
    );
  }

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      settings,
      null,
      2
    ),
    'utf8'
  );
}