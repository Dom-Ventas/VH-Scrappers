import * as fs from 'fs';
import * as path from 'path';
import { userSettingsPath, config } from './config';
import { UserSettings } from './types';

export function loadUserSettings(): UserSettings | null {
  const filePath = userSettingsPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    if (!parsed.emailId || !parsed.profileId) return null;
    return {
      emailId: parsed.emailId,
      profileId: parsed.profileId,
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
