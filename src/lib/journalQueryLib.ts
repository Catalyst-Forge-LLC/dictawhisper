import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { isSkippedWatchPath } from './fileSettleLib.ts';

const PREVIEW_LIMIT = 200;
const FUSE_OPTS = {
  keys: [
    { name: 'tags', weight: 2 },
    { name: 'searchBody', weight: 1.5 },
    { name: 'basename', weight: 1 },
    { name: 'searchRaw', weight: 0.6 },
  ],
  ignoreLocation: true,
  threshold: 0.4,
  includeScore: true,
};

export type JournalNote = {
  jsonFile: string;
  basename: string;
  tags: string[];
  preview: string;
  searchBody: string;
  searchRaw: string;
  cleaned: string;
  raw: string;
  elapsed: string | null;
  hasCleaned: boolean;
  mtimeMs: number;
  day: string;
  cleanup: {
    createdAt?: string;
    model?: string;
    host?: string;
    promptVersion?: number;
  } | null;
};

export type JournalHit = {
  jsonFile: string;
  basename: string;
  day: string;
  tags: string[];
  preview: string;
  score: number;
};

function previewOf(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= PREVIEW_LIMIT) return oneLine;
  return `${oneLine.slice(0, PREVIEW_LIMIT)}…`;
}

function dayOf(jsonFile: string, basename: string, mtimeMs: number): string {
  const named = basename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (named) return named[1];
  const folded = jsonFile.replace(/\\/g, '/').match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
  if (folded) return `${folded[1]}-${folded[2]}-01`;
  return new Date(mtimeMs).toISOString().slice(0, 10);
}

function isSidecarName(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

function looksLikeNote(json: unknown): json is Record<string, unknown> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  const row = json as Record<string, unknown>;
  return Boolean(row.text || row.cleanedTranscription || Array.isArray(row.segments));
}

export function loadJournalNotes(roots: string[]): JournalNote[] {
  const notes: JournalNote[] = [];
  const seen = new Set<string>();

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.resolve(path.join(dir, entry.name));
      if (entry.isDirectory()) {
        if (isSkippedWatchPath(full)) continue;
        walk(full);
        continue;
      }
      if (!isSidecarName(entry.name)) continue;
      if (isSkippedWatchPath(full) || full.includes('_original') || full.includes('_clean')) continue;
      if (seen.has(full)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!looksLikeNote(json)) continue;
        const cleaned = String(json.cleanedTranscription || '').trim();
        const raw = String(json.text || '').trim();
        const source = cleaned || raw;
        const tags = Array.isArray(json.tags)
          ? json.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
          : [];
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        const basename = path.basename(full);
        const rawCleanup = json.cleanup;
        const cleanupRow =
          rawCleanup && typeof rawCleanup === 'object' && !Array.isArray(rawCleanup)
            ? (rawCleanup as Record<string, unknown>)
            : null;
        const cleanup = cleanupRow
          ? {
              createdAt: typeof cleanupRow.createdAt === 'string' ? cleanupRow.createdAt : undefined,
              model: typeof cleanupRow.model === 'string' ? cleanupRow.model : undefined,
              host: typeof cleanupRow.host === 'string' ? cleanupRow.host : undefined,
              promptVersion:
                typeof cleanupRow.promptVersion === 'number' ? cleanupRow.promptVersion : undefined,
            }
          : null;
        notes.push({
          jsonFile: full,
          basename,
          tags,
          preview: previewOf(source),
          searchBody: source,
          searchRaw: raw,
          cleaned,
          raw,
          elapsed: json.elapsed != null ? String(json.elapsed) : null,
          hasCleaned: Boolean(cleaned),
          mtimeMs,
          day: dayOf(full, basename, mtimeMs),
          cleanup,
        });
        seen.add(full);
      } catch {
        // skip unreadable sidecars
      }
    }
  };

  for (const root of roots) walk(path.resolve(root));
  return notes;
}

export function inDayRange(note: JournalNote, since?: string, until?: string): boolean {
  if (since && note.day < since) return false;
  if (until && note.day > until) return false;
  return true;
}

function hasAllTags(note: JournalNote, tags: string[]): boolean {
  if (!tags.length) return true;
  const have = new Set(note.tags.map((tag) => tag.toLowerCase()));
  return tags.every((tag) => have.has(tag.toLowerCase()));
}

function toHit(note: JournalNote, score = 0): JournalHit {
  return {
    jsonFile: note.jsonFile,
    basename: note.basename,
    day: note.day,
    tags: note.tags,
    preview: note.preview,
    score,
  };
}

export function searchJournal(
  notes: JournalNote[],
  options: { query?: string; tags?: string[]; since?: string; until?: string; limit?: number }
): JournalHit[] {
  const tags = (options.tags || []).map((tag) => String(tag).trim()).filter(Boolean);
  const query = String(options.query || '').trim();
  const limit = Math.min(50, Math.max(1, options.limit || 10));
  const pool = notes.filter(
    (note) => hasAllTags(note, tags) && inDayRange(note, options.since, options.until)
  );
  if (!query) {
    return sortRecent(pool)
      .slice(0, limit)
      .map((note) => toHit(note));
  }
  const fuse = new Fuse(pool, FUSE_OPTS);
  return fuse
    .search(query)
    .slice(0, limit)
    .map((result) => toHit(result.item, result.score ?? 0));
}

export function sortRecent(notes: JournalNote[]): JournalNote[] {
  return [...notes].sort((a, b) => {
    if (a.day !== b.day) return b.day.localeCompare(a.day);
    if (a.basename !== b.basename) return b.basename.localeCompare(a.basename);
    return b.mtimeMs - a.mtimeMs;
  });
}

export function recentJournal(
  notes: JournalNote[],
  options: { limit?: number; since?: string; until?: string; tags?: string[] } = {}
): JournalHit[] {
  const limit = Math.min(50, Math.max(1, options.limit || 20));
  const tags = (options.tags || []).map((tag) => String(tag).trim()).filter(Boolean);
  return sortRecent(
    notes.filter((note) => hasAllTags(note, tags) && inDayRange(note, options.since, options.until))
  )
    .slice(0, limit)
    .map((note) => toHit(note));
}

export function listJournalTags(
  notes: JournalNote[],
  options: { includeSingletons?: boolean; limit?: number } = {}
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const min = options.includeSingletons ? 1 : 2;
  const limit = Math.min(500, Math.max(1, options.limit || 200));
  return [...counts.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

export function findJournalNote(notes: JournalNote[], file: string): JournalNote | null {
  const wanted = String(file || '').trim();
  if (!wanted) return null;
  const norm = wanted.replace(/\\/g, '/').toLowerCase();
  const exact = notes.find((note) => note.jsonFile.replace(/\\/g, '/').toLowerCase() === norm);
  if (exact) return exact;
  const base = path.basename(wanted).toLowerCase();
  const matches = notes.filter((note) => note.basename.toLowerCase() === base);
  if (matches.length === 1) return matches[0];
  return null;
}

export function getJournalNote(
  notes: JournalNote[],
  file: string,
  options: { includeRaw?: boolean } = {}
):
  | { ok: true; note: Record<string, unknown> }
  | { ok: false; error: string } {
  const found = findJournalNote(notes, file);
  if (!found) return { ok: false, error: 'note not found under configured watch roots' };
  const note: Record<string, unknown> = {
    jsonFile: found.jsonFile,
    basename: found.basename,
    day: found.day,
    tags: found.tags,
    elapsed: found.elapsed,
    hasCleaned: found.hasCleaned,
    text: found.cleaned || found.raw,
    cleanup: found.cleanup,
  };
  if (options.includeRaw) note.raw = found.raw;
  return { ok: true, note };
}
