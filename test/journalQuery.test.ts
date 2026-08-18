import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  findJournalNote,
  getJournalNote,
  listJournalTags,
  loadJournalNotes,
  recentJournal,
  searchJournal,
} from '../src/lib/journalQueryLib.ts';

function writeNote(dir: string, name: string, body: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

test('loads sidecars and skips junk json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-journal-'));
  const dated = path.join(root, '2026', '08');
  const a = writeNote(dated, '2026-08-15_talk.json', {
    cleanedTranscription: 'Ideas about ForgeTrail permission manifests.',
    text: 'um ideas about forge trail',
    tags: ['forgetrail', 'permissions'],
  });
  writeNote(dated, 'readme.json', { title: 'not a note' });
  const notes = loadJournalNotes([root]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].jsonFile, path.resolve(a));
  assert.equal(notes[0].day, '2026-08-15');
  assert.deepEqual(notes[0].tags, ['forgetrail', 'permissions']);
});

test('search finds words and AND-filters tags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-journal-'));
  writeNote(root, '2026-08-10.json', {
    cleanedTranscription: 'Permission manifests for ForgeTrail.',
    tags: ['forgetrail', 'permissions'],
  });
  writeNote(root, '2026-08-11.json', {
    cleanedTranscription: 'Grocery list and permission to leave early.',
    tags: ['personal'],
  });
  const notes = loadJournalNotes([root]);
  const hits = searchJournal(notes, { query: 'permission manifests', tags: ['forgetrail'] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].basename, '2026-08-10.json');
});

test('recent is newest first and get_note is allowlisted to loaded files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-journal-'));
  writeNote(root, '2026-08-01.json', { cleanedTranscription: 'older', tags: [] });
  writeNote(root, '2026-08-20.json', { cleanedTranscription: 'newer note', tags: ['x'] });
  const notes = loadJournalNotes([root]);
  const recent = recentJournal(notes, { limit: 1 });
  assert.equal(recent[0].basename, '2026-08-20.json');
  const got = getJournalNote(notes, '2026-08-20.json');
  assert.equal(got.ok, true);
  if (got.ok) assert.equal(got.note.text, 'newer note');
  assert.equal(getJournalNote(notes, 'C:\\\\nowhere\\\\secret.json').ok, false);
  assert.ok(findJournalNote(notes, '2026-08-20.json'));
});

test('list_tags hides singletons by default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-journal-'));
  writeNote(root, '2026-08-01.json', { cleanedTranscription: 'a', tags: ['shared', 'once'] });
  writeNote(root, '2026-08-02.json', { cleanedTranscription: 'b', tags: ['shared'] });
  const notes = loadJournalNotes([root]);
  assert.deepEqual(listJournalTags(notes), [{ tag: 'shared', count: 2 }]);
  assert.equal(listJournalTags(notes, { includeSingletons: true }).length, 2);
});
