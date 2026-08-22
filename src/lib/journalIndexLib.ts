import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getLoadablePath } from 'sqlite-vec';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { dayOf } from './journalQueryLib.ts';

const SCHEMA_VERSION = '1';
const PREVIEW_LIMIT = 200;

export type SearchMode = 'lex' | 'semantic' | 'hybrid';

export type IndexSearchHit = {
  jsonFile: string;
  basename: string;
  day: string;
  tags: string[];
  preview: string;
  score: number;
  hasCleaned: boolean;
  audioError: string | null;
};

export type IndexSummary = {
  jsonFile: string;
  basename: string;
  day: string;
  year: string;
  month: string;
  folder: string;
  tags: string[];
  preview: string;
  hasCleaned: boolean;
  audioError: string | null;
};

export type IndexStats = {
  path: string;
  notes: number;
  unreadable: number;
  embedded: number;
  embedModel: string | null;
  embedDim: number | null;
  lastRebuild: string | null;
};

export type IndexListOptions = {
  year?: string;
  month?: string;
  unreadable?: boolean;
  all?: boolean;
};

type NoteRow = {
  json_file: string;
  basename: string;
  day: string;
  year: string;
  month: string;
  folder: string;
  tags: string;
  preview: string;
  has_cleaned: number;
  audio_error: string | null;
  mtime_ms: number;
  text_hash: string;
  body: string;
  raw: string;
};

function rowId(value: number | bigint | string): number {
  return Number(value);
}

/** sqlite-vec rejects REAL-bound rowids; node:sqlite sends JS numbers as REAL. */
function vecRowId(value: number | bigint | string): bigint {
  return BigInt(rowId(value));
}

export class JournalIndex {
  readonly dbPath: string;
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath, { allowExtension: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 8000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.enableLoadExtension(true);
    this.db.loadExtension(getLoadablePath());
    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        json_file TEXT PRIMARY KEY,
        basename TEXT NOT NULL,
        day TEXT NOT NULL,
        year TEXT NOT NULL,
        month TEXT NOT NULL,
        folder TEXT NOT NULL,
        tags TEXT NOT NULL,
        preview TEXT NOT NULL,
        has_cleaned INTEGER NOT NULL,
        audio_error TEXT,
        mtime_ms INTEGER NOT NULL,
        text_hash TEXT NOT NULL,
        body TEXT NOT NULL,
        raw TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notes_day ON notes(day);
      CREATE INDEX IF NOT EXISTS notes_year ON notes(year, month);
      CREATE INDEX IF NOT EXISTS notes_folder ON notes(folder);
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        basename, tags, body, raw,
        content='notes',
        content_rowid='rowid',
        tokenize='unicode61'
      );
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, basename, tags, body, raw)
        VALUES (new.rowid, new.basename, new.tags, new.body, new.raw);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, basename, tags, body, raw)
        VALUES ('delete', old.rowid, old.basename, old.tags, old.body, old.raw);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, basename, tags, body, raw)
        VALUES ('delete', old.rowid, old.basename, old.tags, old.body, old.raw);
        INSERT INTO notes_fts(rowid, basename, tags, body, raw)
        VALUES (new.rowid, new.basename, new.tags, new.body, new.raw);
      END;
    `);
    const version = this.meta('schema_version');
    if (version !== SCHEMA_VERSION) this.setMeta('schema_version', SCHEMA_VERSION);
  }

  meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      value,
    );
  }

  stats(): IndexStats {
    const notes = Number((this.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n);
    const unreadable = Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE audio_error IS NOT NULL AND audio_error != ''").get() as { n: number })
        .n,
    );
    let embedded = 0;
    if (this.hasVec()) {
      embedded = Number((this.db.prepare('SELECT COUNT(*) AS n FROM notes_vec').get() as { n: number }).n);
    }
    const dimRaw = this.meta('embed_dim');
    return {
      path: this.dbPath,
      notes,
      unreadable,
      embedded,
      embedModel: this.meta('embed_model'),
      embedDim: dimRaw ? Number(dimRaw) : null,
      lastRebuild: this.meta('last_rebuild'),
    };
  }

  hasVec(): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes_vec'")
      .get() as { name: string } | undefined;
    return Boolean(row);
  }

  ensureVec(dim: number, model: string) {
    const current = this.meta('embed_dim');
    const currentModel = this.meta('embed_model');
    if (this.hasVec() && current === String(dim) && currentModel === model) return;
    this.db.exec('DROP TABLE IF EXISTS notes_vec');
    this.db.exec(`CREATE VIRTUAL TABLE notes_vec USING vec0(embedding float[${dim}])`);
    this.setMeta('embed_dim', String(dim));
    this.setMeta('embed_model', model);
  }

  upsertSidecar(jsonFile: string): { rowid: number; changed: boolean; skipEmbed: boolean } | null {
    const parsed = readSidecarRow(jsonFile);
    if (!parsed) return null;
    const existing = this.db.prepare('SELECT rowid, text_hash, mtime_ms FROM notes WHERE json_file = ?').get(
      parsed.json_file,
    ) as { rowid: number; text_hash: string; mtime_ms: number } | undefined;
    if (existing && existing.text_hash === parsed.text_hash && existing.mtime_ms === parsed.mtime_ms) {
      return { rowid: rowId(existing.rowid), changed: false, skipEmbed: Boolean(parsed.audio_error) };
    }
    if (existing) {
      this.db
        .prepare(
          `UPDATE notes SET basename=?, day=?, year=?, month=?, folder=?, tags=?, preview=?,
           has_cleaned=?, audio_error=?, mtime_ms=?, text_hash=?, body=?, raw=? WHERE json_file=?`,
        )
        .run(
          parsed.basename,
          parsed.day,
          parsed.year,
          parsed.month,
          parsed.folder,
          parsed.tags,
          parsed.preview,
          parsed.has_cleaned,
          parsed.audio_error,
          parsed.mtime_ms,
          parsed.text_hash,
          parsed.body,
          parsed.raw,
          parsed.json_file,
        );
      if (this.hasVec() && existing.text_hash !== parsed.text_hash) {
        try {
          this.db.prepare('DELETE FROM notes_vec WHERE rowid = ?').run(vecRowId(existing.rowid));
        } catch {
          // vec table may be empty
        }
      }
      return { rowid: rowId(existing.rowid), changed: true, skipEmbed: Boolean(parsed.audio_error) || !parsed.body };
    }
    this.db
      .prepare(
        `INSERT INTO notes (json_file, basename, day, year, month, folder, tags, preview, has_cleaned,
         audio_error, mtime_ms, text_hash, body, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.json_file,
        parsed.basename,
        parsed.day,
        parsed.year,
        parsed.month,
        parsed.folder,
        parsed.tags,
        parsed.preview,
        parsed.has_cleaned,
        parsed.audio_error,
        parsed.mtime_ms,
        parsed.text_hash,
        parsed.body,
        parsed.raw,
      );
    const row = this.db.prepare('SELECT rowid FROM notes WHERE json_file = ?').get(parsed.json_file) as {
      rowid: number;
    };
    return { rowid: rowId(row.rowid), changed: true, skipEmbed: Boolean(parsed.audio_error) || !parsed.body };
  }

  removeSidecar(jsonFile: string) {
    const key = path.resolve(jsonFile);
    const existing = this.db.prepare('SELECT rowid FROM notes WHERE json_file = ?').get(key) as
      | { rowid: number }
      | undefined;
    if (!existing) return;
    if (this.hasVec()) {
      try {
        this.db.prepare('DELETE FROM notes_vec WHERE rowid = ?').run(vecRowId(existing.rowid));
      } catch {
        // ignore
      }
    }
    this.db.prepare('DELETE FROM notes WHERE json_file = ?').run(key);
  }

  putEmbedding(rowid: number, values: number[]) {
    const json = JSON.stringify(values);
    const id = vecRowId(rowid);
    this.db.prepare('DELETE FROM notes_vec WHERE rowid = ?').run(id);
    this.db.prepare('INSERT INTO notes_vec(rowid, embedding) VALUES (?, ?)').run(id, json);
  }

  rowsNeedingEmbed(): { rowid: number; body: string; json_file: string }[] {
    if (!this.hasVec()) {
      return (
        this.db
          .prepare(
            `SELECT rowid, body, json_file FROM notes
           WHERE (audio_error IS NULL OR audio_error = '') AND length(body) > 0`,
          )
          .all() as { rowid: number | bigint; body: string; json_file: string }[]
      ).map((row) => ({ ...row, rowid: rowId(row.rowid) }));
    }
    return (
      this.db
      .prepare(
        `SELECT n.rowid, n.body, n.json_file FROM notes n
         LEFT JOIN notes_vec v ON v.rowid = n.rowid
         WHERE v.rowid IS NULL AND (n.audio_error IS NULL OR n.audio_error = '') AND length(n.body) > 0`,
      )
        .all() as { rowid: number | bigint; body: string; json_file: string }[]
    ).map((row) => ({ ...row, rowid: rowId(row.rowid) }));
  }

  rebuildFromRoots(roots: string[]): { upserted: number; removed: number } {
    const seen = new Set<string>();
    let upserted = 0;
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.resolve(path.join(dir, entry.name));
        if (entry.isDirectory()) {
          if (isSkippedWatchPath(full)) continue;
          walk(full);
          continue;
        }
        if (!entry.name.toLowerCase().endsWith('.json')) continue;
        if (isSkippedWatchPath(full) || full.includes('_original') || full.includes('_clean')) continue;
        const result = this.upsertSidecar(full);
        if (result) {
          seen.add(path.resolve(full));
          if (result.changed) upserted += 1;
        }
      }
    };
    for (const root of roots) walk(path.resolve(root));
    const existing = this.db.prepare('SELECT json_file FROM notes').all() as { json_file: string }[];
    let removed = 0;
    for (const row of existing) {
      if (seen.has(row.json_file)) continue;
      this.removeSidecar(row.json_file);
      removed += 1;
    }
    this.setMeta('last_rebuild', new Date().toISOString());
    return { upserted, removed };
  }

  years(): { year: string; count: number }[] {
    return (
      this.db
        .prepare(
          `SELECT year, COUNT(*) AS count FROM notes WHERE folder = 'journal' AND year != ''
         GROUP BY year ORDER BY year DESC`,
        )
        .all() as { year: string; count: number | bigint }[]
    ).map((row) => ({ year: String(row.year), count: Number(row.count) }));
  }

  findJsonFile(file: string): string | null {
    const wanted = String(file || '').trim();
    if (!wanted) return null;
    const resolved = path.resolve(wanted);
    const exact = this.db.prepare('SELECT json_file FROM notes WHERE json_file = ?').get(resolved) as
      | { json_file: string }
      | undefined;
    if (exact) return exact.json_file;
    const rows = this.db.prepare('SELECT json_file FROM notes WHERE basename = ? COLLATE NOCASE').all(path.basename(wanted)) as {
      json_file: string;
    }[];
    return rows.length === 1 ? rows[0].json_file : null;
  }

  recent(options: { limit?: number; tags?: string[]; since?: string; until?: string } = {}): IndexSearchHit[] {
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const tags = (options.tags || []).map((tag) => tag.trim()).filter(Boolean);
    return this.filterRows({ tags, since: options.since, until: options.until }, limit).map((row) => toHit(row, 0));
  }

  tags(options: { includeSingletons?: boolean; limit?: number } = {}): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    const rows = this.db.prepare('SELECT tags FROM notes').all() as { tags: string }[];
    for (const row of rows) {
      for (const tag of parseTags(row.tags)) {
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

  list(options: IndexListOptions = {}): IndexSummary[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.unreadable) {
      where.push("audio_error IS NOT NULL AND audio_error != ''");
    }
    if (options.year) {
      where.push('year = ?');
      params.push(options.year);
    }
    if (options.month) {
      where.push('month = ?');
      params.push(options.month);
    }
    if (!options.all && !options.year && !options.month && !options.unreadable) {
      const newest = this.db
        .prepare("SELECT MAX(year) AS year FROM notes WHERE folder = 'journal' AND year != ''")
        .get() as { year: string | null };
      if (newest?.year) {
        where.push("(folder IN ('holding', 'unfiled') OR year = ?)");
        params.push(newest.year);
      }
    }
    const sql = `SELECT json_file, basename, day, year, month, folder, tags, preview, has_cleaned, audio_error
      FROM notes ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY day DESC, basename DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<
      Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'body' | 'raw'>
    >;
    return rows.map(toSummary);
  }

  search(options: {
    query?: string;
    tags?: string[];
    since?: string;
    until?: string;
    mode?: SearchMode;
    limit?: number;
    unreadable?: boolean;
    queryEmbedding?: number[] | null;
  }): IndexSearchHit[] {
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const tags = (options.tags || []).map((tag) => tag.trim()).filter(Boolean);
    const query = String(options.query || '').trim();
    const mode = options.mode || 'lex';
    const filters = { tags, since: options.since, until: options.until, unreadable: options.unreadable };
    if (!query && !tags.length && !options.unreadable) return [];

    if (!query) {
      return this.filterRows(filters, limit).map((row) => toHit(row, 0));
    }

    const lexHits = this.searchLex(query, { ...filters, limit: 80 });
    if (mode === 'lex' || !options.queryEmbedding || !this.hasVec()) {
      return lexHits.slice(0, limit);
    }

    const semHits = this.searchSemantic(options.queryEmbedding, { ...filters, limit: 80 });
    if (mode === 'semantic') return semHits.slice(0, limit);
    return rrfMerge(lexHits, semHits, limit);
  }

  private searchLex(
    query: string,
    options: { tags: string[]; since?: string; until?: string; unreadable?: boolean; limit: number },
  ): IndexSearchHit[] {
    const match = buildFtsQuery(query);
    if (!match) return [];
    const { extra, params } = this.filterSql(options);
    const rows = this.db
      .prepare(
        `SELECT n.json_file, n.basename, n.day, n.tags, n.preview, n.has_cleaned, n.audio_error,
                bm25(notes_fts) AS rank
         FROM notes_fts
         JOIN notes n ON n.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ? ${extra}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(match, ...params, options.limit) as Array<
      Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'body' | 'raw' | 'year' | 'month' | 'folder'> & { rank: number }
    >;
    return rows.map((row) => toHit(row, Number(row.rank) || 0));
  }

  private searchSemantic(
    embedding: number[],
    options: { tags: string[]; since?: string; until?: string; unreadable?: boolean; limit: number },
  ): IndexSearchHit[] {
    const { extra, params } = this.filterSql(options);
    const rows = this.db
      .prepare(
        `SELECT n.json_file, n.basename, n.day, n.tags, n.preview, n.has_cleaned, n.audio_error,
                v.distance AS rank
         FROM notes_vec v
         JOIN notes n ON n.rowid = v.rowid
         WHERE v.embedding MATCH ? AND k = ? ${extra}
         ORDER BY v.distance`,
      )
      .all(JSON.stringify(embedding), options.limit, ...params) as Array<
      Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'body' | 'raw' | 'year' | 'month' | 'folder'> & { rank: number }
    >;
    return rows.map((row) => toHit(row, Number(row.rank) || 0));
  }

  private filterRows(
    options: { tags: string[]; since?: string; until?: string; unreadable?: boolean },
    limit: number,
  ): NoteRow[] {
    const { extra, params } = this.filterSql(options);
    return this.db
      .prepare(`SELECT * FROM notes n WHERE 1=1 ${extra} ORDER BY day DESC, basename DESC LIMIT ?`)
      .all(...params, limit) as NoteRow[];
  }

  private filterSql(options: { tags: string[]; since?: string; until?: string; unreadable?: boolean }): {
    extra: string;
    params: Array<string | number>;
  } {
    const extra: string[] = [];
    const params: Array<string | number> = [];
    if (options.since) {
      extra.push('AND n.day >= ?');
      params.push(options.since);
    }
    if (options.until) {
      extra.push('AND n.day <= ?');
      params.push(options.until);
    }
    if (options.unreadable) {
      extra.push("AND n.audio_error IS NOT NULL AND n.audio_error != ''");
    }
    for (const tag of options.tags) {
      extra.push('AND lower(n.tags) LIKE ?');
      params.push(`%${JSON.stringify(tag.toLowerCase()).slice(1, -1)}%`);
    }
    return { extra: extra.join(' '), params };
  }
}

function toSummary(row: {
  json_file: string;
  basename: string;
  day: string;
  year: string;
  month: string;
  folder: string;
  tags: string;
  preview: string;
  has_cleaned: number;
  audio_error: string | null;
}): IndexSummary {
  return {
    jsonFile: row.json_file,
    basename: row.basename,
    day: row.day,
    year: row.year,
    month: row.month,
    folder: row.folder,
    tags: parseTags(row.tags),
    preview: row.preview,
    hasCleaned: Boolean(row.has_cleaned),
    audioError: row.audio_error,
  };
}

function toHit(
  row: {
    json_file: string;
    basename: string;
    day: string;
    tags: string;
    preview: string;
    has_cleaned: number;
    audio_error: string | null;
  },
  score: number,
): IndexSearchHit {
  return {
    jsonFile: row.json_file,
    basename: row.basename,
    day: row.day,
    tags: parseTags(row.tags),
    preview: row.preview,
    score,
    hasCleaned: Boolean(row.has_cleaned),
    audioError: row.audio_error,
  };
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function folderOf(jsonFile: string): string {
  const norm = jsonFile.replace(/\\/g, '/');
  if (/\/_holding(?:\/|$)/i.test(norm)) return 'holding';
  if (/\/_unfiled(?:\/|$)/i.test(norm)) return 'unfiled';
  return 'journal';
}

function previewOf(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= PREVIEW_LIMIT) return oneLine;
  return `${oneLine.slice(0, PREVIEW_LIMIT)}…`;
}

export function readSidecarRow(jsonFile: string): NoteRow | null {
  const resolved = path.resolve(jsonFile);
  if (!fs.existsSync(resolved)) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    return null;
  }
  const cleaned = String(json.cleanedTranscription || '').trim();
  const raw = String(json.text || '').trim();
  const source = cleaned || raw;
  const audioError = json.audioError ? String(json.audioError) : null;
  if (!source && !audioError && !Array.isArray(json.segments)) return null;
  const tags = Array.isArray(json.tags)
    ? json.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(resolved).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  const basename = path.basename(resolved);
  const day = dayOf(resolved, basename.replace(/\.json$/i, ''), mtimeMs);
  const textHash = createHash('sha1').update(`${cleaned}\0${raw}\0${tags.join(',')}`).digest('hex');
  return {
    json_file: resolved,
    basename,
    day,
    year: day.slice(0, 4),
    month: day.slice(5, 7),
    folder: folderOf(resolved),
    tags: JSON.stringify(tags),
    preview: audioError && !source ? '[unreadable audio]' : previewOf(source),
    has_cleaned: cleaned ? 1 : 0,
    audio_error: audioError,
    mtime_ms: mtimeMs,
    text_hash: textHash,
    body: cleaned || raw,
    raw,
  };
}

export function buildFtsQuery(query: string): string {
  const filename = query.match(/^filename:\s*(.+)$/i);
  const raw = filename ? filename[1] : query;
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(/["']/g, '').replace(/[^\p{L}\p{N}_*-]/gu, ''))
    .filter((token) => token.length > 1 || /\p{L}/u.test(token));
  if (!tokens.length) return '';
  const parts = tokens.map((token) => {
    const cleaned = token.replace(/\*+$/g, '');
    return `${cleaned}*`;
  });
  const joined = parts.join(' AND ');
  return filename ? `{basename} : ${joined}` : joined;
}

function rrfMerge(lex: IndexSearchHit[], sem: IndexSearchHit[], limit: number): IndexSearchHit[] {
  const k = 60;
  const scores = new Map<string, { hit: IndexSearchHit; score: number }>();
  lex.forEach((hit, i) => {
    scores.set(hit.jsonFile, { hit, score: 1 / (k + i + 1) });
  });
  sem.forEach((hit, i) => {
    const prev = scores.get(hit.jsonFile);
    const add = 1 / (k + i + 1);
    if (prev) prev.score += add;
    else scores.set(hit.jsonFile, { hit, score: add });
  });
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({ ...row.hit, score: row.score }));
}

let singleton: JournalIndex | null = null;

export function openJournalIndex(dbPath: string): JournalIndex {
  return new JournalIndex(dbPath);
}

export function getJournalIndex(): JournalIndex | null {
  return singleton;
}

export function setJournalIndex(index: JournalIndex | null) {
  singleton = index;
}
