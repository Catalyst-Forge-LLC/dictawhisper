import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JournalIndex, buildFtsQuery } from '../src/lib/journalIndexLib.ts';

function writeNote(dir: string, name: string, body: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

test('buildFtsQuery prefix-ANDs tokens', () => {
  assert.equal(buildFtsQuery('Kristen sangria'), 'Kristen* AND sangria*');
  assert.match(buildFtsQuery('filename:Record008'), /basename/);
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
