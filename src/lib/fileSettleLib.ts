import fs from 'fs';
import path from 'path';

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const started = new Set<string>();

const DEFAULT_SETTLE_MINUTES = 30;
const RETRY_SLACK_MS = 2000;

export function getSettleMs(): number {
  const msRaw = process.env.VOICE_SETTLE_MS?.trim();
  if (msRaw) {
    const parsed = Number(msRaw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  const minutesRaw = process.env.VOICE_SETTLE_MINUTES?.trim();
  if (minutesRaw) {
    const parsed = Number(minutesRaw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed * 60_000;
  }
  return DEFAULT_SETTLE_MINUTES * 60_000;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = (minutes / 60).toFixed(1);
  return `${hours}h`;
}

/** Syncthing / incomplete-transfer names we should never organize or transcribe. */
export function isTransientSyncFile(filePath: string): boolean {
  const name = path.basename(filePath);
  const lower = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    name.includes('sync-conflict') ||
    name.includes('~syncthing~') ||
    name.startsWith('.syncthing.') ||
    name.endsWith('.tmp') ||
    lower.includes('/.stfolder') ||
    lower.includes('/.stversions/') ||
    lower.includes('/_holding/')
  );
}

export type FileReadiness = {
  ready: boolean;
  reason: string;
  ageMs: number;
  waitMs: number;
  size: number;
  mtime: Date | null;
};

export function inspectFileReadiness(filePath: string, settleMs: number = getSettleMs()): FileReadiness {
  if (isTransientSyncFile(filePath)) {
    return {
      ready: false,
      reason: 'syncthing/temp artifact',
      ageMs: 0,
      waitMs: 0,
      size: 0,
      mtime: null,
    };
  }
  if (!fs.existsSync(filePath)) {
    return { ready: false, reason: 'missing', ageMs: 0, waitMs: 0, size: 0, mtime: null };
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    return { ready: false, reason: 'not a file', ageMs: 0, waitMs: 0, size: 0, mtime: null };
  }
  if (stats.size <= 0) {
    return {
      ready: false,
      reason: 'empty',
      ageMs: 0,
      waitMs: Math.max(settleMs, 10_000),
      size: 0,
      mtime: stats.mtime,
    };
  }

  const ageMs = Date.now() - stats.mtimeMs;
  if (settleMs > 0 && ageMs < settleMs) {
    return {
      ready: false,
      reason: `mtime only ${formatDuration(ageMs)} old (need ${formatDuration(settleMs)} since last write)`,
      ageMs,
      waitMs: settleMs - ageMs + RETRY_SLACK_MS,
      size: stats.size,
      mtime: stats.mtime,
    };
  }

  return {
    ready: true,
    reason: settleMs === 0 ? 'settle disabled' : `mtime stable for ${formatDuration(ageMs)}`,
    ageMs,
    waitMs: 0,
    size: stats.size,
    mtime: stats.mtime,
  };
}

function fileKey(filePath: string): string {
  return path.normalize(filePath);
}

/**
 * Run `action` only after the file has not been written for VOICE_SETTLE_MINUTES
 * (default 60). Syncthing updates mtime while a phone recording is still syncing,
 * so this waits until the last write — not until first appearance.
 *
 * Pass `{ force: true }` to skip the wait. Reschedules if the file is written again.
 */
export function requestWhenSettled(
  filePath: string,
  action: () => void | Promise<void>,
  options: { force?: boolean; label?: string } = {}
): void {
  const label = options.label ?? 'settle';
  const key = `${label}:${fileKey(filePath)}`;
  const settleMs = getSettleMs();

  const clearTimer = () => {
    const timer = pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(key);
    }
  };

  const run = () => {
    if (started.has(key)) return;
    started.add(key);
    Promise.resolve(action()).catch((error) => {
      started.delete(key);
      console.error(`[${label}] action failed for ${filePath}:`, error);
    });
  };

  if (options.force) {
    clearTimer();
    console.log(`[${label}] forced; skipping settle for ${filePath}`);
    run();
    return;
  }

  if (started.has(key)) return;

  const status = inspectFileReadiness(filePath, settleMs);
  if (status.ready) {
    clearTimer();
    console.log(`[${label}] ready (${status.reason}, ${status.size} bytes): ${filePath}`);
    run();
    return;
  }

  if (status.waitMs <= 0) {
    console.log(`[${label}] skipping ${filePath}: ${status.reason}`);
    return;
  }

  clearTimer();
  console.log(
    `[${label}] waiting ${formatDuration(status.waitMs)} for ${filePath} (${status.reason}, ${status.size} bytes)`
  );
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      requestWhenSettled(filePath, action, options);
    }, status.waitMs)
  );
}

export function logSettleConfig(label = 'settle'): void {
  const settleMs = getSettleMs();
  console.log(
    `[${label}] process files ${settleMs === 0 ? 'immediately (settle disabled)' : `${formatDuration(settleMs)} after last write`}` +
      ` (VOICE_SETTLE_MINUTES / VOICE_SETTLE_MS; force via POST /transcribe/force)`
  );
}
