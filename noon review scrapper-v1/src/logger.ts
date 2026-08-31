import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.resolve('./logs');
const LOG_RETENTION_DAYS = 7;

function ensureLogDirectory(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, {
      recursive: true
    });
  }
}

function getLogFile(): string {
  const today =
    new Date().toISOString().split('T')[0];

  return path.join(LOG_DIR, `${today}.log`);
}

function deleteOldLogs(): void {
  ensureLogDirectory();

  const files = fs.readdirSync(LOG_DIR);

  const now = Date.now();

  for (const file of files) {
    if (!file.endsWith('.log')) {
      continue;
    }

    const filePath = path.join(LOG_DIR, file);

    const stat = fs.statSync(filePath);

    const age =
      (now - stat.mtime.getTime()) /
      (1000 * 60 * 60 * 24);

    if (age > LOG_RETENTION_DAYS) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    }
  }
}

function write(
  level: string,
  args: unknown[]
): void {

  ensureLogDirectory();

  const message =
    args
      .map(a =>
        typeof a === 'string'
          ? a
          : a instanceof Error
            ? `${a.message}\n${a.stack || ''}`
            : JSON.stringify(a)
      )
      .join(' ');

  const line =
    `[${new Date().toISOString()}] [${level}] ${message}\n`;

  try {
    fs.appendFileSync(
      getLogFile(),
      line,
      'utf8'
    );
  } catch {}
}

/**
 * Mirrors console output into a daily rotating file, so an unattended run can
 * be diagnosed after the fact. Called once from index.ts.
 */
export function initLogger(): void {
  deleteOldLogs();

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    write('INFO', args);
  };

  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    write('WARN', args);
  };

  console.error = (...args: unknown[]) => {
    original.error(...args);
    write('ERROR', args);
  };

  original.log(
    `[BOOT] logging to ${getLogFile()}`
  );
}
