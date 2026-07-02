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
 */
function backupIdPath(): string {
  const programData =
    process.env.PROGRAMDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(programData, 'VentaHubAgent', 'device.id');
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
  const backupPath = backupIdPath();

  const existing = tryRead(localPath) || tryRead(backupPath);
  const id = existing || randomUUID();

  writeIfMissing(localPath, id);
  writeIfMissing(backupPath, id);
  return id;
}
