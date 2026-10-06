import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getLoadablePath } from 'sqlite-vec';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { mayDoSummary, validMayDos, type MayDoFilter } from './mayDoLib.ts';
import { dayOf } from './journalQueryLib.ts';

const SCHEMA_VERSION = '5';
const PREVIEW_LIMIT = 200;

export type SearchMode = 'lex' | 'semantic' | 'hybrid';
export type SearchSort = 'recent' | 'oldest' | 'relevance';
export type IndexFolder = 'active' | 'unfiled' | 'holding';

export type IndexSearchHit = {
  entryId?: string;
  jsonFile: string;
  basename: string;
  displayTitle?: string;
  day: string;
  tags: string[];
  preview: string;
  snippet?: string;
  cue?: number | null;
  score: number;
  hasCleaned: boolean;
  audioError: string | null;
  starred: boolean;
  mayDoTotalCount: number;
  mayDoStatusCounts: Record<string, number>;
  mayDoCount: number;
  mayDoActiveCount: number;
  mayDoStatuses: string[];
};

export type EntryPageOptions = {
  query?: string; tags?: string[]; since?: string; until?: string; year?: string; month?: string;
  mode?: SearchMode; sort?: SearchSort; limit?: number; cursor?: string;
  unreadable?: boolean; starred?: boolean; folder?: IndexFolder; attention?: boolean;
  mayDos?: MayDoFilter; queryEmbedding?: number[] | null; synonyms?: string[];
};
export type EntryPage = {
  items: IndexSearchHit[]; total: number; countKind: 'exact' | 'ranked';
  hasMore: boolean; nextCursor: string | null; candidateLimit?: number;
  mode: SearchMode; expiresAt?: number;
};
export class EntryCursorError extends Error {
  code: 'invalid_cursor' | 'cursor_expired';
  constructor(code: 'invalid_cursor' | 'cursor_expired') {
    super(code === 'cursor_expired' ? 'Results changed or expired. Refresh results to continue.' : 'This cursor does not match the current search.');
    this.code = code;
  }
}

export type IndexSummary = {
  entryId?: string;
  jsonFile: string;
  basename: string;
  displayTitle?: string;
  day: string;
  year: string;
  month: string;
  folder: string;
  tags: string[];
  preview: string;
  hasCleaned: boolean;
  audioError: string | null;
  starred: boolean;
  mayDoTotalCount: number;
  mayDoStatusCounts: Record<string, number>;
  mayDoCount: number;
  mayDoActiveCount: number;
  mayDoStatuses: string[];
};

export type IndexStats = {
  path: string;
  notes: number;
  unreadable: number;
  starred: number;
  mayDos: number;
  embedded: number;
  embedModel: string | null;
  embedDim: number | null;
  lastRebuild: string | null;
};

export type IndexListOptions = {
  year?: string;
  month?: string;
  unreadable?: boolean;
  starred?: boolean;
  all?: boolean;
  folder?: IndexFolder;
  attention?: boolean;
  mayDos?: MayDoFilter;
};

type NoteRow = {
  display_title: string;
  entry_id?: string;
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
  starred: number;
  may_dos: string;
  cleanup_error: string | null;
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

  private cursorSecret = randomBytes(32);
  private snapshots = new Map<string, { key: string; hits: IndexSearchHit[]; expiresAt: number; mode: SearchMode }>();
  private now: () => number;

  constructor(dbPath: string, options: { now?: () => number } = {}) {
    this.now = options.now || Date.now;
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
    const noteCols = (
      this.db.prepare('PRAGMA table_info(notes)').all() as { name: string }[]
    ).map((row) => row.name);
    if (!noteCols.includes('starred')) {
      this.db.exec('ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');
    }
    if (!noteCols.includes('display_title')) {
      this.db.exec("ALTER TABLE notes ADD COLUMN display_title TEXT NOT NULL DEFAULT ''");
      const update = this.db.prepare('UPDATE notes SET display_title = ? WHERE json_file = ?');
      for (const row of this.db.prepare('SELECT json_file FROM notes').all() as { json_file: string }[]) {
        try { update.run(String(JSON.parse(fs.readFileSync(row.json_file, 'utf8')).displayTitle || ''), row.json_file); } catch { /* Reconciled during refresh. */ }
      }
    }
    if (!noteCols.includes('entry_id')) {
      this.db.exec("ALTER TABLE notes ADD COLUMN entry_id TEXT NOT NULL DEFAULT ''");
      const update = this.db.prepare('UPDATE notes SET entry_id = ? WHERE json_file = ?');
      for (const row of this.db.prepare('SELECT json_file FROM notes').all() as {json_file:string}[]) {
        try { update.run(String(JSON.parse(fs.readFileSync(row.json_file,'utf8')).entryId || ''),row.json_file); } catch {}
      }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS notes_entry_id ON notes(entry_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS notes_starred ON notes(starred)');
    if (!noteCols.includes('may_dos')) this.db.exec("ALTER TABLE notes ADD COLUMN may_dos TEXT NOT NULL DEFAULT '[]'");
    if (!noteCols.includes('cleanup_error')) {
      this.db.exec('ALTER TABLE notes ADD COLUMN cleanup_error TEXT');
      const update = this.db.prepare('UPDATE notes SET cleanup_error = ? WHERE json_file = ?');
      for (const row of this.db.prepare('SELECT json_file FROM notes').all() as { json_file: string }[]) {
        try {
          const json = JSON.parse(fs.readFileSync(row.json_file, 'utf8'));
          if (json.cleanupError) update.run(String(json.cleanupError), row.json_file);
        } catch { /* Missing/unreadable sidecars are reconciled by the existing index refresh. */ }
      }
    }
    const ftsCols = (this.db.prepare('PRAGMA table_info(notes_fts)').all() as { name: string }[]).map(row => row.name);
    const rebuildFts = ftsCols.length > 0 && !ftsCols.includes('display_title');
    if (rebuildFts) this.db.exec('DROP TRIGGER IF EXISTS notes_ai; DROP TRIGGER IF EXISTS notes_ad; DROP TRIGGER IF EXISTS notes_au; DROP TABLE notes_fts');
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        basename, tags, body, raw, display_title,
        content='notes',
        content_rowid='rowid',
        tokenize='unicode61'
      );
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, basename, tags, body, raw, display_title)
        VALUES (new.rowid, new.basename, new.tags, new.body, new.raw, new.display_title);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, basename, tags, body, raw, display_title)
        VALUES ('delete', old.rowid, old.basename, old.tags, old.body, old.raw, old.display_title);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, basename, tags, body, raw, display_title)
        VALUES ('delete', old.rowid, old.basename, old.tags, old.body, old.raw, old.display_title);
        INSERT INTO notes_fts(rowid, basename, tags, body, raw, display_title)
        VALUES (new.rowid, new.basename, new.tags, new.body, new.raw, new.display_title);
      END;
    `);
    if (rebuildFts) this.db.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
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
    const starred = Number(
      (this.db.prepare('SELECT COUNT(*) AS n FROM notes WHERE starred = 1').get() as { n: number }).n,
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
      starred,
      mayDos: Number((this.db.prepare('SELECT COUNT(*) AS n FROM notes WHERE json_array_length(may_dos) > 0').get() as { n: number }).n),
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
    const existing = this.db.prepare('SELECT rowid, text_hash, mtime_ms, display_title, entry_id FROM notes WHERE json_file = ?').get(
      parsed.json_file,
    ) as { rowid: number; text_hash: string; mtime_ms: number; display_title: string; entry_id: string } | undefined;
    if (existing && existing.text_hash === parsed.text_hash && existing.mtime_ms === parsed.mtime_ms && existing.display_title === parsed.display_title && existing.entry_id === (parsed.entry_id || '')) {
      return { rowid: rowId(existing.rowid), changed: false, skipEmbed: Boolean(parsed.audio_error) };
    }
    if (existing) {
      this.db
        .prepare(
          `UPDATE notes SET entry_id=?, display_title=?, basename=?, day=?, year=?, month=?, folder=?, tags=?, preview=?,
           has_cleaned=?, audio_error=?, starred=?, may_dos=?, cleanup_error=?, mtime_ms=?, text_hash=?, body=?, raw=? WHERE json_file=?`,
        )
        .run(
          parsed.entry_id || '',
          parsed.display_title,
          parsed.basename,
          parsed.day,
          parsed.year,
          parsed.month,
          parsed.folder,
          parsed.tags,
          parsed.preview,
          parsed.has_cleaned,
          parsed.audio_error,
          parsed.starred,
          parsed.may_dos,
          parsed.cleanup_error,
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
      return { rowid: rowId(existing.rowid), changed: true, skipEmbed: Boolean(parsed.audio_error) || !parsed.body || existing.text_hash === parsed.text_hash };
    }
    this.db
      .prepare(
        `INSERT INTO notes (entry_id, display_title, json_file, basename, day, year, month, folder, tags, preview, has_cleaned,
         audio_error, starred, may_dos, cleanup_error, mtime_ms, text_hash, body, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.entry_id || '',
        parsed.display_title,
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
        parsed.starred,
        parsed.may_dos,
        parsed.cleanup_error,
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
  relocateSidecar(oldFile: string, newFile: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.upsertSidecar(newFile)) throw new Error('Moved entry could not be indexed.');
      if (path.resolve(oldFile) !== path.resolve(newFile)) this.removeSidecar(oldFile);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
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
      entry_id?: string;
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
    if (options.starred) {
      where.push('starred = 1');
    }
    if (options.year) {
      where.push("(folder IN ('holding', 'unfiled') OR year = ?)");
      params.push(options.year);
    }
    if (options.month && options.year) {
      where.push("(folder IN ('holding', 'unfiled') OR month = ?)");
      params.push(options.month);
    }
    if (!options.all && !options.year && !options.month && !options.unreadable && !options.starred) {
      const newest = this.db
        .prepare("SELECT MAX(year) AS year FROM notes WHERE folder = 'journal' AND year != ''")
        .get() as { year: string | null };
      if (newest?.year) {
        where.push("(folder IN ('holding', 'unfiled') OR year = ?)");
        params.push(newest.year);
      }
    }
    if (options.mayDos || options.folder || options.attention) {
      const filter = this.filterSql({ tags: [], mayDos: options.mayDos, folder: options.folder, attention: options.attention });
      where.push(filter.extra.replace(/^AND /, ''));
      params.push(...filter.params);
    }
    const sql = `SELECT entry_id, json_file, display_title, basename, day, year, month, folder, tags, preview, has_cleaned, audio_error, starred, may_dos
      FROM notes n ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY day DESC, basename DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<
      Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'body' | 'raw'>
    >;
    return rows.map(toSummary);
  }

  /** Legacy callers keep their capped array response. New clients use searchPage. */
  search(options: EntryPageOptions): IndexSearchHit[] {
    if (!options.query?.trim() && !options.tags?.length && !options.since && !options.until && !options.year &&
      !options.month && !options.folder && !options.starred && !options.unreadable && !options.attention && !options.mayDos) return [];
    return this.searchPage({ ...options, limit: options.limit || 20, cursor: undefined }).items;
  }

  private encodeCursor(value: object): string {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return body + '.' + createHmac('sha256', this.cursorSecret).update(body).digest('base64url');
  }

  private decodeCursor(cursor: string): { key: string; offset: number; revision?: string; snapshot?: string } {
    try {
      if (cursor.length > 2048) throw new Error();
      const [body, signature, extra] = cursor.split('.');
      const expected = createHmac('sha256', this.cursorSecret).update(body).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
      const value = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (!Number.isSafeInteger(value.offset) || value.offset < 1 || typeof value.key !== 'string') throw new Error();
      return value;
    } catch { throw new EntryCursorError('invalid_cursor'); }
  }

  searchPage(options: EntryPageOptions): EntryPage {
    const limit = Math.min(50, Math.max(1, Math.floor(options.limit || 50)));
    const query = String(options.query || '').trim();
    const range = options.since || options.until ? {} : yearMonthRange(options.year, options.month);
    const filters = {
      tags: [...new Set((options.tags || []).map(tag => tag.trim().toLowerCase()).filter(Boolean))].sort(),
      since: options.since || range.since, until: options.until || range.until,
      unreadable: Boolean(options.unreadable), starred: Boolean(options.starred), folder: options.folder,
      attention: Boolean(options.attention),
      mayDos: Array.isArray(options.mayDos) ? [...new Set(options.mayDos)].sort() : options.mayDos,
    };
    const requestedMode = !query || isFilenameQuery(query) ? 'lex' : options.mode || 'lex';
    const sort = options.sort || (query ? 'relevance' : 'recent');
    const key = createHash('sha256').update(JSON.stringify({ query, filters, requestedMode, sort, synonyms: options.synonyms || [] })).digest('hex');
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;
    if (cursor && cursor.key !== key) throw new EntryCursorError('invalid_cursor');
    const offset = cursor?.offset || 0;
    const now = this.now();
    for (const [id, snapshot] of this.snapshots) if (snapshot.expiresAt <= now) this.snapshots.delete(id);
    let snapshot = cursor?.snapshot ? this.snapshots.get(cursor.snapshot) : undefined;
    if (cursor?.snapshot && !snapshot) throw new EntryCursorError('cursor_expired');
    if (!cursor && requestedMode !== 'lex' && options.queryEmbedding && this.hasVec()) {
      const lex = this.searchLex(query, { ...filters, limit: 500, synonyms: options.synonyms });
      const sem = this.searchSemantic(options.queryEmbedding, { ...filters, limit: 500 });
      const hits = sortHits(requestedMode === 'semantic' ? sem : rrfMerge(lex, sem, 500), sort);
      const id = randomUUID();
      snapshot = { key, hits, expiresAt: now + 60_000, mode: requestedMode };
      // Bound both lifetime and memory, even when callers repeatedly create new searches.
      while (this.snapshots.size >= 32) this.snapshots.delete(this.snapshots.keys().next().value!);
      this.snapshots.set(id, snapshot);
      return this.snapshotPage(id, snapshot, 0, limit);
    }
    if (snapshot) return this.snapshotPage(cursor!.snapshot!, snapshot, offset, limit);
    // Offset paging is valid only while this index is unchanged. Never silently skip/duplicate after an edit.
    const revision = JSON.stringify(this.db.prepare('SELECT total_changes() AS writes').get()) +
      JSON.stringify(this.db.prepare('PRAGMA data_version').get());
    if (cursor && cursor.revision !== revision) throw new EntryCursorError('cursor_expired');
    const { extra, params } = this.filterSql(filters);
    let from = 'notes n'; let where = `1=1 ${extra}`; let args: (string | number)[] = params;
    let rank = '0'; let snippet = 'NULL';
    if (query) {
      const match = buildFtsQuery(query, options.synonyms);
      if (match) {
        from = 'notes_fts JOIN notes n ON n.rowid = notes_fts.rowid';
        where = `notes_fts MATCH ? ${extra}`; args = [match, ...params];
        rank = 'bm25(notes_fts)'; snippet = "snippet(notes_fts, 2, '', '', '…', 24)";
        try { this.db.prepare(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`).get(...args); }
        catch { from = 'notes n'; }
      }
      if (from === 'notes n') {
        const needle = query.replace(/^filename:\s*/i, '').trim().replace(/[!%_]/g, char => `!${char}`);
        where = needle.replace(/!/g, '').length < 2 ? '0' : `lower(n.basename) LIKE ? ESCAPE '!' ${extra}`;
        args = where === '0' ? [] : [`%${needle.toLowerCase()}%`, ...params];
        rank = '0'; snippet = 'NULL';
      }
    }
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM ${from} WHERE ${where}`).get(...args) as { total: number }).total);
    const direction = sort === 'oldest' ? 'ASC' : 'DESC';
    const order = (sort === 'relevance' && query ? 'rank ASC, ' : '') + `n.day ${direction}, n.basename ${direction}, n.json_file ${direction}`;
    const rows = this.db.prepare(`SELECT n.*, ${rank} AS rank, ${snippet} AS snippet FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, limit, offset) as (NoteRow & { rank: number; snippet?: string })[];
    const items = rows.map(row => toHit(row, Number(row.rank), { snippet: row.snippet || undefined, cue: query ? cueIndexForQuery(row.body, query) : null }));
    const hasMore = offset + items.length < total;
    return { items, total, countKind: 'exact', mode: 'lex', hasMore,
      nextCursor: hasMore ? this.encodeCursor({ key, revision, offset: offset + items.length }) : null };
  }

  private snapshotPage(id: string, snapshot: { key: string; hits: IndexSearchHit[]; expiresAt: number; mode: SearchMode }, offset: number, limit: number): EntryPage {
    const items = snapshot.hits.slice(offset, offset + limit);
    const hasMore = offset + items.length < snapshot.hits.length;
    return { items, total: snapshot.hits.length, countKind: 'ranked', candidateLimit: 500,
      mode: snapshot.mode, expiresAt: snapshot.expiresAt, hasMore,
      nextCursor: hasMore ? this.encodeCursor({ key: snapshot.key, snapshot: id, offset: offset + items.length }) : null };
  }

  private searchLex(
    query: string,
    options: {
      tags: string[];
      since?: string;
      until?: string;
      unreadable?: boolean;
      starred?: boolean;
      folder?: IndexFolder;
      attention?: boolean;
      mayDos?: MayDoFilter;
      limit: number;
      synonyms?: string[];
    },
  ): IndexSearchHit[] {
    const match = buildFtsQuery(query, options.synonyms);
    const { extra, params } = this.filterSql(options);
    if (match) {
      try {
        const rows = this.db
          .prepare(
            `SELECT n.entry_id, n.json_file, n.display_title, n.basename, n.day, n.tags, n.preview, n.has_cleaned, n.audio_error, n.starred, n.may_dos,
                    n.body, snippet(notes_fts, 2, '', '', '…', 24) AS snippet,
                    bm25(notes_fts) AS rank
             FROM notes_fts
             JOIN notes n ON n.rowid = notes_fts.rowid
             WHERE notes_fts MATCH ? ${extra}
             ORDER BY rank, n.day DESC, n.json_file DESC
             LIMIT ?`,
          )
          .all(match, ...params, options.limit) as Array<
          Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'raw' | 'year' | 'month' | 'folder'> & {
            rank: number;
            snippet?: string;
          }
        >;
        return rows.map((row) =>
          toHit(row, Number(row.rank) || 0, {
            snippet: String(row.snippet || '').trim() || undefined,
            cue: cueIndexForQuery(row.body, query),
          }),
        );
      } catch {
        // hyphenated filenames and other FTS syntax — fall through to LIKE
      }
    }
    return this.searchBasenameLike(query, { ...options, extra, params });
  }

  private searchBasenameLike(
    query: string,
    options: { extra: string; params: Array<string | number>; limit: number },
  ): IndexSearchHit[] {
    const needle = String(query || '')
      .replace(/^filename:\s*/i, '')
      .trim()
      .replace(/[!%_]/g, (char) => `!${char}`);
    if (needle.replace(/!/g, '').length < 2) return [];
    const rows = this.db
      .prepare(
        `SELECT n.entry_id, n.json_file, n.display_title, n.basename, n.day, n.tags, n.preview, n.has_cleaned, n.audio_error, n.starred, n.may_dos
         FROM notes n
         WHERE lower(n.basename) LIKE ? ESCAPE '!' ${options.extra}
         ORDER BY n.day DESC, n.basename DESC
         LIMIT ?`,
      )
      .all(`%${needle.toLowerCase()}%`, ...options.params, options.limit) as Array<
      Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'body' | 'raw' | 'year' | 'month' | 'folder'>
    >;
    return rows.map((row) => toHit(row, 0));
  }

  private searchSemantic(
    embedding: number[],
    options: { tags: string[]; since?: string; until?: string; unreadable?: boolean; starred?: boolean; folder?: IndexFolder;
    attention?: boolean;
    mayDos?: MayDoFilter; limit: number },
  ): IndexSearchHit[] {
    const { extra, params } = this.filterSql(options);
    const rows = this.db
      .prepare(
        `SELECT n.entry_id, n.json_file, n.display_title, n.basename, n.day, n.tags, n.preview, n.has_cleaned, n.audio_error, n.starred, n.may_dos,
                vec_distance_L2(v.embedding, ?) AS rank
         FROM notes_vec v
         JOIN notes n ON n.rowid = v.rowid
         WHERE 1=1 ${extra}
         ORDER BY rank, n.day DESC, n.json_file DESC LIMIT ?`,
      )
      .all(JSON.stringify(embedding), ...params, options.limit) as Array<
      Omit<NoteRow, 'mtime_ms' | 'text_hash' | 'body' | 'raw' | 'year' | 'month' | 'folder'> & { rank: number }
    >;
    return rows.map((row) => toHit(row, Number(row.rank) || 0));
  }

  private filterRows(
    options: { tags: string[]; since?: string; until?: string; unreadable?: boolean; starred?: boolean; folder?: IndexFolder;
    attention?: boolean; mayDos?: MayDoFilter },
    limit: number,
  ): NoteRow[] {
    const { extra, params } = this.filterSql(options);
    return this.db
      .prepare(`SELECT * FROM notes n WHERE 1=1 ${extra} ORDER BY day DESC, basename DESC LIMIT ?`)
      .all(...params, limit) as NoteRow[];
  }

  private filterSql(options: {
    tags: string[];
    since?: string;
    until?: string;
    unreadable?: boolean;
    starred?: boolean;
    folder?: IndexFolder;
    attention?: boolean;
    mayDos?: MayDoFilter;
  }): {
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
    if (options.starred) {
      extra.push('AND n.starred = 1');
    }
    if (options.folder === 'active') extra.push("AND n.folder NOT IN ('holding', 'trash')");
    else if (options.folder) {
      extra.push('AND n.folder = ?');
      params.push(options.folder);
    }
    if (options.attention) {
      extra.push("AND (n.folder IN ('holding', 'unfiled') OR COALESCE(n.audio_error, '') != '' OR COALESCE(n.cleanup_error, '') != '')");
    }
    if (options.mayDos === 'any') extra.push('AND json_array_length(n.may_dos) > 0');
    else if (options.mayDos) {
      const statuses = Array.isArray(options.mayDos) ? options.mayDos : [options.mayDos];
      if (!statuses.length) extra.push('AND 0');
      else {
        extra.push(`AND EXISTS (SELECT 1 FROM json_each(n.may_dos) md WHERE json_extract(md.value, '$.status') IN (${statuses.map(() => '?').join(',')}))`);
        params.push(...statuses);
      }
    }
    for (const tag of options.tags) {
      extra.push('AND EXISTS (SELECT 1 FROM json_each(n.tags) tag WHERE lower(tag.value) = ?)');
      params.push(tag.toLowerCase());
    }
    return { extra: extra.join(' '), params };
  }
}

function toSummary(row: {
  entry_id?: string;
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
  display_title?: string;
  starred?: number;
  may_dos?: string;
}): IndexSummary {
  return {
    entryId: row.entry_id || undefined,
    jsonFile: row.json_file,
    basename: row.basename,
    displayTitle: row.display_title || undefined,
    day: row.day,
    year: row.year,
    month: row.month,
    folder: row.folder,
    tags: parseTags(row.tags),
    preview: row.preview,
    hasCleaned: Boolean(row.has_cleaned),
    audioError: row.audio_error,
    starred: Boolean(row.starred),
    ...mayDoSummary(JSON.parse(row.may_dos || '[]')),
  };
}

function toHit(
  row: {
    entry_id?: string;
  json_file: string;
    basename: string;
    day: string;
    tags: string;
    preview: string;
    has_cleaned: number;
    audio_error: string | null;
    display_title?: string;
    starred?: number;
    may_dos?: string;
  },
  score: number,
  extra: { snippet?: string; cue?: number | null } = {},
): IndexSearchHit {
  return {
    entryId: row.entry_id || undefined,
    jsonFile: row.json_file,
    basename: row.basename,
    displayTitle: row.display_title || undefined,
    day: row.day,
    tags: parseTags(row.tags),
    preview: row.preview,
    snippet: extra.snippet,
    cue: extra.cue ?? null,
    score,
    hasCleaned: Boolean(row.has_cleaned),
    audioError: row.audio_error,
    starred: Boolean(row.starred),
    ...mayDoSummary(JSON.parse(row.may_dos || '[]')),
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
  if (isSkippedWatchPath(resolved) || !fs.existsSync(resolved)) return null;
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
  const day = typeof json.recordedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.recordedDate) ? json.recordedDate : dayOf(resolved, basename.replace(/\.json$/i, ''), mtimeMs);
  const starred = json.starred === true || json.starred === 1 ? 1 : 0;
  const textHash = createHash('sha1').update(`${cleaned}\0${raw}\0${tags.join(',')}\0${starred}`).digest('hex');
  return {
    entry_id: String(json.entryId || ''),
    json_file: resolved,
    display_title: String(json.displayTitle || ''),
    basename,
    day,
    year: day.slice(0, 4),
    month: day.slice(5, 7),
    folder: folderOf(resolved),
    tags: JSON.stringify(tags),
    preview: audioError && !source ? '[unreadable audio]' : previewOf(source),
    has_cleaned: cleaned ? 1 : 0,
    audio_error: audioError,
    starred,
    may_dos: JSON.stringify(validMayDos(json.mayDos)),
    cleanup_error: json.cleanupError ? String(json.cleanupError) : null,
    mtime_ms: mtimeMs,
    text_hash: textHash,
    body: cleaned || raw,
    raw,
  };
}

const FTS_WORDS = new Set(['and', 'or', 'not', 'near']);

/** House names and Whisper typos. Prompt terms are passed in at query time. */
export const HOUSE_SEARCH_NAMES = ['Kristen', 'Kisten', 'Kristin', 'Mindcorp'];

const HOUSE_GROUPS = [
  ['kristen', 'kisten', 'kristin'],
  ['mindcorp', 'mind-corp'],
];

export function editDistance(a: string, b: string): number {
  const left = String(a || '');
  const right = String(b || '');
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) grid[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[left.length][right.length];
}

export function synonymGroupFor(token: string, extraTerms: string[] = []): string[] {
  const raw = String(token || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const hits = new Set<string>([raw]);
  const pool = [...HOUSE_SEARCH_NAMES, ...extraTerms].map((term) => String(term || '').trim()).filter(Boolean);
  for (const term of pool) {
    const t = term.toLowerCase();
    if (t === lower || (lower.length >= 4 && t.length >= 4 && editDistance(lower, t) <= 1)) {
      hits.add(term);
    }
  }
  for (const group of HOUSE_GROUPS) {
    if (group.includes(lower) || [...hits].some((hit) => group.includes(hit.toLowerCase()))) {
      for (const alias of group) hits.add(alias);
    }
  }
  return [...hits];
}

export function queryTokens(query: string): string[] {
  return String(query || '')
    .replace(/^filename:\s*/i, '')
    .split(/[^\p{L}\p{N}*]+/u)
    .map((token) => token.replace(/\*+$/g, ''))
    .filter((token) => token.length > 1 || /\p{L}/u.test(token));
}

export function noteSections(text: string): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  const paras = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paras.length >= 2) return paras;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  return sentences.length >= 2 ? sentences : [trimmed];
}

export function cueIndexForQuery(body: string, query: string): number | null {
  if (isFilenameQuery(query)) return null;
  const tokens = queryTokens(query).map((token) => token.toLowerCase());
  if (!tokens.length) return null;
  const sections = noteSections(body);
  const index = sections.findIndex((section) => {
    const lower = section.toLowerCase();
    return tokens.some((token) => lower.includes(token));
  });
  return index >= 0 ? index : null;
}

export function isFilenameQuery(query: string): boolean {
  const raw = String(query || '').replace(/^filename:\s*/i, '').trim();
  if (!raw) return false;
  if (/^filename:/i.test(query)) return true;
  return /\d{4}[-_.]\d{2}[-_.]\d{2}/.test(raw) || /\.(mp3|m4a|wav|webm|ogg|json)$/i.test(raw);
}

function ftsToken(token: string): string {
  return FTS_WORDS.has(token.toLowerCase()) ? `"${token}"` : `${token}*`;
}

export function buildFtsQuery(query: string, extraTerms: string[] = []): string {
  const filename = query.match(/^filename:\s*(.+)$/i);
  const raw = filename ? filename[1] : query;
  const looksLikeName = isFilenameQuery(query);
  const tokens = queryTokens(raw);
  if (!tokens.length) return '';
  const parts = tokens.map((token) => {
    if (looksLikeName) return ftsToken(token);
    const group = synonymGroupFor(token, extraTerms);
    if (group.length <= 1) return ftsToken(token);
    return `(${group.map((alias) => ftsToken(alias)).join(' OR ')})`;
  });
  const joined = parts.join(' AND ');
  return looksLikeName ? `{basename} : ${joined}` : joined;
}

export function yearMonthRange(year?: string, month?: string): { since?: string; until?: string } {
  const y = String(year || '').trim();
  if (!/^\d{4}$/.test(y)) return {};
  const m = String(month || '').trim().padStart(2, '0');
  if (/^\d{2}$/.test(m) && Number(m) >= 1 && Number(m) <= 12) {
    const last = new Date(Number(y), Number(m), 0).getDate();
    return { since: `${y}-${m}-01`, until: `${y}-${m}-${String(last).padStart(2, '0')}` };
  }
  return { since: `${y}-01-01`, until: `${y}-12-31` };
}

function sortHits(hits: IndexSearchHit[], sort: SearchSort): IndexSearchHit[] {
  if (sort === 'relevance') return hits;
  const copy = [...hits];
  copy.sort((a, b) => {
    const day = String(a.day).localeCompare(String(b.day));
    const name = String(a.basename).localeCompare(String(b.basename));
    const key = String(a.jsonFile).localeCompare(String(b.jsonFile));
    return sort === 'oldest' ? day || name || key : -(day || name || key);
  });
  return copy;
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
    .sort((a, b) => b.score - a.score || b.hit.day.localeCompare(a.hit.day) || b.hit.jsonFile.localeCompare(a.hit.jsonFile))
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
