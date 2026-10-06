import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { JournalIndex, buildFtsQuery, cueIndexForQuery } from '../src/lib/journalIndexLib.ts';

function writeNote(dir: string, name: string, body: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

test('existing journal indexes migrate MayDo storage without losing entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-maydo-migrate-'));
  const dbPath = path.join(root, 'journal.sqlite');
  try {
    const old = new JournalIndex(dbPath);
    writeNote(root, '2026-08-01.json', { text: 'An existing journal entry.' });
    old.rebuildFromRoots([root]);
    old.close();
    const db = new DatabaseSync(dbPath);
    db.exec('ALTER TABLE notes DROP COLUMN may_dos');
    db.close();
    const migrated = new JournalIndex(dbPath);
    try {
      assert.equal(migrated.stats().notes, 1);
      assert.equal(migrated.stats().mayDos, 0);
      assert.equal(migrated.list({ all: true })[0].mayDoCount, 0);
    } finally { migrated.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('buildFtsQuery prefix-ANDs tokens', () => {
  assert.match(buildFtsQuery('Kristen sangria'), /sangria\*/);
  assert.match(buildFtsQuery('Kisten'), /Kristen\*/);
  assert.match(buildFtsQuery('filename:Record008'), /basename/);
  assert.equal(
    buildFtsQuery('2016-06-01_12-06-25'),
    '{basename} : 2016* AND 06* AND 01* AND 12* AND 06* AND 25*',
  );
});

test('FTS search finds words and AND-filters tags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-idx-'));
  const dbPath = path.join(root, 'journal.sqlite');
  writeNote(path.join(root, '2026', '08'), '2026-08-15_talk.json', {
    cleanedTranscription: 'Ideas about ForgeTrail permission manifests.',
    text: 'um ideas about forge trail',
    tags: ['forgetrail', 'permissions'],
  });
  writeNote(path.join(root, '2026', '08'), '2026-08-11_shop.json', {
    cleanedTranscription: 'Grocery list and permission to leave early.',
    tags: ['personal'],
  });
  const index = new JournalIndex(dbPath);
  index.rebuildFromRoots([root]);
  const hits = index.search({ query: 'permission manifests', tags: ['forgetrail'] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].basename, '2026-08-15_talk.json');
  assert.equal(index.stats().notes, 2);
  index.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('folder search combines with words, stars, and dates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-folder-'));
  const index = new JournalIndex(path.join(root, 'journal.sqlite'));
  try {
    writeNote(path.join(root, '_unfiled'), '2026-08-01_unfiled.json', { cleanedTranscription: 'journal plans', tags: ['plans'], starred: true });
    writeNote(path.join(root, '_holding'), '2026-08-01_holding.json', { cleanedTranscription: 'journal plans', tags: ['plans'], starred: true });
    writeNote(path.join(root, '2026', '08'), '2026-08-01_dated.json', { cleanedTranscription: 'journal plans', tags: ['plans'], starred: true });
    index.rebuildFromRoots([root]);
    const hits = index.search({ query: 'journal', folder: 'unfiled', starred: true, tags: ['plans'], year: '2026' });
    assert.equal(hits.length, 1);
    assert.match(hits[0].basename, /unfiled/);
    assert.equal(index.search({ folder: 'holding' }).length, 1);
    assert.equal(index.search({ query: 'journal', folder: 'unfiled', year: '2010' }).length, 0);
  } finally {
    index.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sqlite-vec hybrid ranks a nearby vector first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-vec-'));
  const dbPath = path.join(root, 'journal.sqlite');
  const a = writeNote(root, '2026-08-01.json', {
    cleanedTranscription: 'We bought Powerball tickets after dinner.',
    tags: [],
  });
  writeNote(root, '2026-08-02.json', {
    cleanedTranscription: 'Unrelated meeting notes about invoices.',
    tags: [],
  });
  const index = new JournalIndex(dbPath);
  index.rebuildFromRoots([root]);
  index.ensureVec(4, 'test');
  const rowA = index.upsertSidecar(a);
  assert.ok(rowA);
  index.putEmbedding(rowA.rowid, [1, 0, 0, 0]);
  const others = index.rowsNeedingEmbed();
  for (const row of others) {
    index.putEmbedding(row.rowid, [0, 1, 0, 0]);
  }
  const hits = index.search({
    query: 'lottery tickets',
    mode: 'hybrid',
    queryEmbedding: [0.95, 0.05, 0, 0],
  });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].basename, '2026-08-01.json');
  index.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('search sorts the hit page and filters starred / year', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-idx-sort-'));
  const dbPath = path.join(root, 'journal.sqlite');
  writeNote(path.join(root, '2015', '07'), '2015-07-02.json', {
    cleanedTranscription: 'tickets for the show',
    tags: ['music'],
    starred: true,
  });
  writeNote(path.join(root, '2015', '08'), '2015-08-10.json', {
    cleanedTranscription: 'more tickets later',
    tags: ['music'],
  });
  writeNote(path.join(root, '2013', '01'), '2013-01-05.json', {
    cleanedTranscription: 'tickets in another year',
    tags: ['music'],
  });
  const index = new JournalIndex(dbPath);
  index.rebuildFromRoots([root]);
  const recent = index.search({ query: 'tickets', sort: 'recent' });
  assert.equal(recent[0].basename, '2015-08-10.json');
  const oldest = index.search({ query: 'tickets', sort: 'oldest' });
  assert.equal(oldest[0].basename, '2013-01-05.json');
  const starred = index.search({ query: 'tickets', starred: true });
  assert.equal(starred.length, 1);
  assert.equal(starred[0].starred, true);
  const july = index.search({ query: 'tickets', year: '2015', month: '07' });
  assert.equal(july.length, 1);
  assert.equal(july[0].day, '2015-07-02');
  index.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('house-name typo hits the canonical note and lands on a cue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-idx-syn-'));
  const dbPath = path.join(root, 'journal.sqlite');
  writeNote(path.join(root, '2013', '07'), '2013-07-04.json', {
    cleanedTranscription: 'Dinner was late.\n\nKristen mentioned sangria and the tickets.',
    tags: ['Kristen'],
  });
  const index = new JournalIndex(dbPath);
  index.rebuildFromRoots([root]);
  const hits = index.search({ query: 'Kisten sangria' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].basename, '2013-07-04.json');
  assert.ok(hits[0].snippet);
  assert.equal(hits[0].cue, 1);
  assert.equal(
    cueIndexForQuery('Dinner was late.\n\nKristen mentioned sangria and the tickets.', 'sangria'),
    1,
  );
  index.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('dated filename query does not throw and hits basename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-idx-name-'));
  const dbPath = path.join(root, 'journal.sqlite');
  writeNote(path.join(root, '2016', '06'), '2016-06-01_12-06-25 My recording.json', {
    cleanedTranscription: 'A walk after lunch.',
    tags: [],
  });
  writeNote(path.join(root, '2016', '06'), '2016-06-02_09-00-00 other.json', {
    cleanedTranscription: 'Unrelated note.',
    tags: [],
  });
  const index = new JournalIndex(dbPath);
  index.rebuildFromRoots([root]);
  const hits = index.search({ query: '2016-06-01_12-06-25' });
  assert.equal(hits.length, 1);
  assert.match(hits[0].basename, /2016-06-01_12-06-25/);
  const hybrid = index.search({
    query: '2016-06-01_12-06-25',
    mode: 'hybrid',
    queryEmbedding: [0.2, 0.1, 0.1, 0.1],
  });
  assert.equal(hybrid.length, 1);
  index.close();
  fs.rmSync(root, { recursive: true, force: true });
});


test('MayDo filters combine with text, dates, tags and stars and update without losing embeddings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-maydo-index-'));
  const index = new JournalIndex(path.join(root, 'journal.sqlite'));
  const action = { id: 'one', title: 'Call dentist', sourceQuote: 'Need to call dentist', status: 'selected' };
  try {
    const file = writeNote(root, '2026-08-01.json', { cleanedTranscription: 'Need to call dentist', tags: ['plans'], starred: true, mayDos: [action] });
    writeNote(root, '2026-08-02.json', { cleanedTranscription: 'Need to call dentist', tags: ['plans'], mayDos: [{ ...action, status: 'done' }] });
    writeNote(root, '2026-08-03.json', { cleanedTranscription: 'Need to call dentist', tags: ['plans'] });
    index.rebuildFromRoots([root]);
    assert.equal(index.stats().mayDos, 2);
    assert.equal(index.list({ all: true, mayDos: 'any' }).length, 2);
    const hits = index.search({ query: 'dentist', mayDos: 'selected', starred: true, tags: ['plans'], year: '2026' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].mayDoCount, 1);
    assert.deepEqual(hits[0].mayDoStatuses, ['selected']);
    assert.equal(index.search({ mayDos: 'suggested' }).length, 0);
    index.ensureVec(4, 'test');
    const row = index.upsertSidecar(file);
    index.putEmbedding(row.rowid, [1, 0, 0, 0]);
    const changed = JSON.parse(fs.readFileSync(file, 'utf8'));
    changed.mayDos[0].status = 'dismissed';
    fs.writeFileSync(file, JSON.stringify(changed));
    assert.equal(index.upsertSidecar(file).skipEmbed, true);
    assert.equal(index.search({ mayDos: 'selected' }).length, 0);
    assert.equal(index.search({ mayDos: 'dismissed' }).length, 1);
    assert.equal(index.stats().embedded, 1);
  } finally { index.close(); fs.rmSync(root, { recursive: true, force: true }); }
});


test('status OR and exact tag AND are applied on the server before the result cap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-status-set-'));
  const index = new JournalIndex(path.join(root, 'journal.sqlite'));
  try {
    for (let i = 0; i < 70; i++) {
      writeNote(root, `2026-09-01_${String(i).padStart(3, '0')}.json`, {
        text: 'Kitchen repair plan', tags: i < 60 ? ['home-improvement', 'budget'] : ['home', 'budget'],
        mayDos: [{ id: String(i), title: 'Repair', sourceQuote: 'Kitchen repair plan', status: i % 2 ? 'selected' : 'suggested' }],
      });
    }
    const done = writeNote(root, '2025-01-01_done.json', { text: 'Kitchen repair plan', tags: ['home', 'budget'],
      mayDos: [{ id: 'done', title: 'Repair', sourceQuote: 'Kitchen repair plan', status: 'done' }] });
    index.rebuildFromRoots([root]);
    const hits = index.search({ query: 'kitchen', tags: ['home', 'budget'], mayDos: ['suggested', 'selected'], limit: 50 });
    assert.equal(hits.length, 10);
    assert.equal(hits.some(hit => hit.jsonFile === done), false);
    assert.deepEqual(new Set(hits.flatMap(hit => hit.mayDoStatuses)), new Set(['suggested', 'selected']));
    assert.equal(index.search({ mayDos: 'done', tags: ['home', 'budget'] })[0].jsonFile, done);
  } finally { index.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('active library spans older entries and unfiled; attention includes real errors and holding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-scopes-'));
  const dbPath = path.join(root, 'journal.sqlite');
  let index = new JournalIndex(dbPath);
  try {
    const old = writeNote(path.join(root, '2010', '07'), '2010-07-01.json', { text: 'Kitchen plan' });
    const unfiled = writeNote(path.join(root, '_unfiled'), 'unfiled.json', { text: 'Kitchen plan' });
    const holding = writeNote(path.join(root, '_holding'), 'holding.json', { text: 'Kitchen plan' });
    const failed = writeNote(path.join(root, '2026', '09'), '2026-09-01.json', { text: 'Kitchen plan', cleanupError: 'Host unavailable' });
    index.rebuildFromRoots([root]);
    const active = index.list({ all: true, folder: 'active' }).map(note => note.jsonFile);
    assert(active.includes(old)); assert(active.includes(unfiled)); assert(!active.includes(holding));
    assert.equal(index.search({ query: 'kitchen', folder: 'active' }).length, 3);
    const attention = index.search({ attention: true, limit: 50 }).map(note => note.jsonFile);
    assert.deepEqual(new Set(attention), new Set([unfiled, holding, failed]));
    assert.equal(index.search({ year: '2010', until: '2026-12-31', folder: 'active', limit: 50 }).length, 3);
    index.close();
    const db = new DatabaseSync(dbPath); db.exec('ALTER TABLE notes DROP COLUMN cleanup_error'); db.close();
    index = new JournalIndex(dbPath);
    assert(index.search({ attention: true }).some(note => note.jsonFile === failed));
  } finally { index.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
