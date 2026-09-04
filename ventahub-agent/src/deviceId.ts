import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

/**
 * The device id is generated once and persisted in TWO locations so that a
 * config reset (or reinstall under the same OS user) keeps the same identity —
 * and therefore the manager-set assignment for this laptop. If a laptop is
 * fully reimaged the id is lost and the device re-registers as new (reverting
 * to the global default); the admin can spot it by hostname and re-assign.
 *
 * The backup is namespaced by the agent's home directory name, NOT by a fixed
 * constant. One laptop runs one agent per marketplace and each needs its own
 * identity: a shared path would hand all of them the same deviceId, so they
 * would collide on a single `app_scraper_device` row, be served the same
 * assignment, and overwrite each other's last_seen and profileIds.
 *
 * Deriving it from `path.basename(homeDir)` keeps the amazon agent's path
 * byte-identical to what it has always been (`…\VentaHubAgent\device.id`), so
 * upgrading an existing laptop preserves its id and its assignment.
 */
function backupIdPath(homeDir: string): string {
  const programData =
    process.env.PROGRAMDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(programData, path.basename(homeDir), 'device.id');
}

function tryRead(p: string): string | null {
  try {
    if (fs.existsSync(p)) {
      const id = fs.readFileSync(p, 'utf-8').trim();
      return id || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeIfMissing(p: string, id: string): void {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, id, 'utf-8');
  } catch {
    /* best-effort */
  }
}

export function getOrCreateDeviceId(homeDir: string): string {
  const localPath = path.join(homeDir, 'device.id');
  const backupPath = backupIdPath(homeDir);

  const existing = tryRead(localPath) || tryRead(backupPath);
  const id = existing || randomUUID();

  writeIfMissing(localPath, id);
  writeIfMissing(backupPath, id);
  return id;
}
