import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mergeMayDos, mayDoSourceHash, parseMayDoFilter } from '../src/lib/mayDoLib.ts';
import { backfillMayDos, type MayDoBackfillJob } from '../src/lib/mayDoBackfillLib.ts';
import { extractMayDos } from '../src/lib/mayDoService.ts';
import { patchTranscription } from '../src/lib/transcriptionLib.ts';
import type { TranscriptionDocument } from '../src/types/transcription.ts';

const source = 'I need to call the dentist. Maybe I will repair the shelf.';
const candidate = { title: 'Call the dentist', verb: 'call', sourceQuote: 'I need to call the dentist.' };
const make = () => mergeMayDos([], [candidate], source, [{ text: source, start: 12, end: 20 }]);

test('extraction grounds quotes and timing in the transcript and ignores invented metadata', () => {
  const rows = mergeMayDos([], [
    { ...candidate, status: 'done', id: 'fake', start: 800 }, candidate,
    { title: 'Buy a car', verb: 'buy', sourceQuote: 'I need to buy a car.' },
  ], source, [{ text: source, start: 12, end: 20 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'suggested');
  assert.equal(rows[0].start, 12);
  assert.notEqual(rows[0].id, 'fake');
  assert.equal(parseMayDoFilter('bad'), undefined);
});

test('re-extraction preserves identity and human decisions, including omitted actions', () => {
  const previous = make();
  previous[0].status = 'selected';
  const renamed = mergeMayDos(previous, [{ ...candidate, title: 'Phone the dentist' }], source);
  assert.equal(renamed[0].id, previous[0].id);
  assert.equal(renamed[0].status, 'selected');
  assert.deepEqual(mergeMayDos(previous, [], source), previous);
  assert.deepEqual(mergeMayDos(make(), [], source), []);
  const two = mergeMayDos([], [candidate, { ...candidate, title: 'Schedule the appointment' }], source);
  assert.equal(mergeMayDos(two, [candidate, { ...candidate, title: 'Schedule the appointment' }], source).length, 2);
});

test('manual extraction preserves concurrent edits and rejects changed transcripts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-maydo-'));
  const file = path.join(dir, 'note.json');
  const write = (json: unknown) => fs.writeFileSync(file, JSON.stringify(json));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    write({ text: source, tags: ['old'], mayDos: make() });
    const result = await extractMayDos(file, async () => {
      const fresh = read(); fresh.tags = ['new']; fresh.displayTitle = 'Human title'; fresh.starred = true; fresh.mayDos[0].status = 'done'; write(fresh);
      return { mayDos: [candidate] };
    });
    assert.deepEqual(result.transcriptionJson.tags, ['new']);
    assert.equal(result.transcriptionJson.displayTitle, 'Human title');
    assert.equal(result.transcriptionJson.starred, true);
    assert.equal(result.transcriptionJson.mayDos?.[0].status, 'done');
    assert.equal(read().mayDoExtraction.sourceHash, mayDoSourceHash(source));
    const before = read().mayDos;
    await assert.rejects(extractMayDos(file, async () => { throw new Error('Model unavailable'); }), /Model unavailable/);
    assert.deepEqual(read().mayDos, before);
    await assert.rejects(extractMayDos(file, async () => {
      write({ ...read(), text: 'Different transcript', tags: ['latest'] });
      return { mayDos: [candidate] };
    }), /changed during extraction/);
    assert.deepEqual(read().mayDos, before);
    assert.deepEqual(read().tags, ['latest']);
    assert.match(read().mayDoError, /changed/);
    assert.throws(() => patchTranscription(file, { mayDo: { id: before[0].id, status: 'bad' } }), /invalid/);
    assert.throws(() => patchTranscription(file, { mayDo: { id: 'missing', status: 'done' } }), /not found/);
    patchTranscription(file, { mayDo: { id: before[0].id, status: 'dismissed' } });
    assert.equal(read().mayDos[0].status, 'dismissed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const job = (): MayDoBackfillJob => ({ running: true, stopping: false, total: 4, processed: 0, updated: 0, failed: 0, skipped: 0, current: '', errors: [] });

test('backfill skips current entries, retries errors and continues after failures', async () => {
  const progress = job();
  const notes = {
    current: { text: source, mayDoExtraction: { version: 1, sourceHash: mayDoSourceHash(source) } },
    empty: { text: '' }, retry: { text: source, mayDoError: 'failed' }, fail: { text: source },
  };
  const extracted: string[] = [];
  await backfillMayDos(Object.keys(notes), progress, false,
    file => notes[file] as TranscriptionDocument,
    async file => { extracted.push(file); if (file === 'fail') throw new Error('Model unavailable'); });
  assert.deepEqual(extracted, ['retry', 'fail']);
  assert.equal(progress.processed, 4);
  assert.equal(progress.skipped, 2);
  assert.equal(progress.updated, 1);
  assert.equal(progress.failed, 1);
  assert.equal(progress.running, false);
});

test('backfill stops after the current entry and refresh overrides the source hash', async () => {
  const progress = job();
  await backfillMayDos(['first', 'second'], progress, true,
    () => ({ text: source, mayDoExtraction: { version: 1, sourceHash: mayDoSourceHash(source), createdAt: '' } } as TranscriptionDocument),
    async () => { progress.stopping = true; });
  assert.equal(progress.processed, 1);
  assert.equal(progress.updated, 1);
  assert.equal(progress.running, false);
});
