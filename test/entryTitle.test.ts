import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { JournalIndex } from '../src/lib/journalIndexLib.ts';
import { patchTranscription } from '../src/lib/transcriptionLib.ts';

test('display title patch is additive, validated, indexed and clearable without renaming the file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-title-'));
  const file = path.join(root, '2026-10-01_Recording.json');
  const index = new JournalIndex(path.join(root, 'index.sqlite'));
  try {
    fs.writeFileSync(file, JSON.stringify({ text: 'Original speech.', tags: ['human'], starred: true, mayDos: [] }));
    patchTranscription(file, { displayTitle: '  Kitchen renovation  ' }); index.upsertSidecar(file);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.displayTitle, 'Kitchen renovation'); assert.equal(saved.starred, true); assert.deepEqual(saved.tags, ['human']);
    assert.equal(index.list({ all: true })[0].displayTitle, 'Kitchen renovation');
    assert.equal(index.search({ query: 'renovation', limit: 50 })[0].displayTitle, 'Kitchen renovation');
    assert.throws(() => patchTranscription(file, { displayTitle: 'x'.repeat(161) }), /invalid display title/);
    patchTranscription(file, { displayTitle: '' }); index.upsertSidecar(file);
    assert.equal(index.list({ all: true })[0].displayTitle, undefined);
    assert.equal(index.search({ query: 'renovation', limit: 50 }).length, 0);
    assert.equal(fs.existsSync(file), true);
  } finally { index.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('old cached title/FTS schema migrates from sidecars without rewriting the source document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-title-migrate-'));
  const file = path.join(root, '2026-10-01_Recording.json'), dbPath = path.join(root, 'index.sqlite');
  try {
    const source = JSON.stringify({ text: 'Original speech.', displayTitle: 'Kitchen renovation' });
    fs.writeFileSync(file, source);
    const index = new JournalIndex(dbPath); index.upsertSidecar(file); index.close();
    const db = new DatabaseSync(dbPath);
    db.exec("DROP TRIGGER notes_ai; DROP TRIGGER notes_ad; DROP TRIGGER notes_au; DROP TABLE notes_fts; ALTER TABLE notes DROP COLUMN display_title; CREATE VIRTUAL TABLE notes_fts USING fts5(basename, tags, body, raw, content='notes', content_rowid='rowid');"); db.close();
    const migrated = new JournalIndex(dbPath);
    try { assert.equal(migrated.search({ query: 'renovation', limit: 50 })[0].displayTitle, 'Kitchen renovation'); assert.equal(fs.readFileSync(file, 'utf8'), source); }
    finally { migrated.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
