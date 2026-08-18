import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CleanupRecord, TranscriptionDocument } from '../types/transcription.ts';

export const CLEANUP_HISTORY_CAP = 20;

let cachedVersion = '';

export function dictawhisperVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    cachedVersion = typeof version === 'string' && version.trim() ? version.trim() : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

function asRecord(value: unknown): CleanupRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as CleanupRecord;
  const text = String(row.text || '').trim();
  if (!text) return null;
  const out: CleanupRecord = { text };
  if (typeof row.createdAt === 'string' && row.createdAt.trim()) out.createdAt = row.createdAt;
  if (typeof row.model === 'string' && row.model.trim()) out.model = row.model;
  if (typeof row.host === 'string' && row.host.trim()) out.host = row.host;
  if (typeof row.promptVersion === 'number' && Number.isFinite(row.promptVersion)) {
    out.promptVersion = row.promptVersion;
  }
  if (typeof row.dictawhisperVersion === 'string' && row.dictawhisperVersion.trim()) {
    out.dictawhisperVersion = row.dictawhisperVersion;
  }
  return out;
}

/** Current structured record, or a stub from legacy `cleanedTranscription` + `meta`. */
export function currentCleanupRecord(json: TranscriptionDocument): CleanupRecord | null {
  const stored = asRecord(json.cleanup);
  if (stored) return stored;
  const text = String(json.cleanedTranscription || '').trim();
  if (!text) return null;
  const meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
  const stub: CleanupRecord = { text };
  if (typeof meta.model === 'string' && meta.model.trim()) stub.model = meta.model;
  if (typeof meta.machine === 'string' && meta.machine.trim()) stub.host = meta.machine;
  if (typeof json.promptVersion === 'number' && Number.isFinite(json.promptVersion)) {
    stub.promptVersion = json.promptVersion;
  }
  return stub;
}

export function applyCleanupProvenance(
  json: TranscriptionDocument,
  next: CleanupRecord
): CleanupRecord {
  const previous = currentCleanupRecord(json);
  if (previous) {
    const history = [previous, ...(Array.isArray(json.cleanupHistory) ? json.cleanupHistory : [])]
      .map(asRecord)
      .filter((row): row is CleanupRecord => Boolean(row))
      .slice(0, CLEANUP_HISTORY_CAP);
    json.cleanupHistory = history;
  }
  const cleanup: CleanupRecord = {
    text: next.text,
    createdAt: next.createdAt || new Date().toISOString(),
    promptVersion: next.promptVersion,
    dictawhisperVersion: next.dictawhisperVersion || dictawhisperVersion(),
  };
  if (next.model) cleanup.model = next.model;
  if (next.host) cleanup.host = next.host;
  json.cleanup = cleanup;
  json.cleanedTranscription = next.text;
  if (typeof next.promptVersion === 'number') json.promptVersion = next.promptVersion;
  return cleanup;
}
