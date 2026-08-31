import * as fs from 'fs';
import * as path from 'path';
import { userSettingsPath } from './config';
import { UserSettings } from './types';

export function loadUserSettings(): UserSettings | null {
  const filePath = userSettingsPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UserSettings> & { profileId?: string };
    if (!parsed.emailId) return null;

    // Support both the new `profileIds: string[]` shape and the legacy
    // `profileId: string` shape so older settings files keep working.
    let profileIds: string[] = [];
    if (Array.isArray(parsed.profileIds)) {
      profileIds = parsed.profileIds.map((p) => String(p).trim()).filter(Boolean);
    } else if (typeof parsed.profileId === 'string' && parsed.profileId.trim()) {
      profileIds = [parsed.profileId.trim()];
    }
    if (profileIds.length === 0) return null;

    return {
      emailId: parsed.emailId,
      profileIds,
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
