import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { config } from '../src/config.ts';
import { TranscriptionBatchService } from '../src/lib/transcriptionBatchLib.ts';
import { AudioRescueService } from '../src/lib/audioRescueService.ts';
import { createTranscriptionBatchRoutes } from '../src/transcriptionBatchRoutes.ts';
import { setActivityStore, ActivityStore } from '../src/lib/activityLib.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-batch-'));
config.watch.roots = [root]; config.watch.browserDropFolder = root; config.watch.settleMinutes = 0;
config.journal.index = path.join(root, 'index.sqlite'); config.journal.embedModel = ''; config.journal.search = 'lex';
config.queues.transcription.active = true; setActivityStore(new ActivityStore());
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const scope = { year: '', selection: 'outdated', model: 'large-v3' } as const;
function setup(count = 2, flagged = false, afterFirstTranscript?: () => void) {
  const directory = path.join(root, randomUUID()); fs.mkdirSync(directory);
  const files = Array.from({ length: count }, (_, i) => {
    const jsonFile = path.join(directory, `entry-${i}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify({ entryId: randomUUID(), text: 'Old transcript', cleanedTranscription: 'Old readable', tags: ['keep'], displayTitle: 'My title', mayDos: [{ id: 'action', status: 'done' }] }));
    fs.writeFileSync(jsonFile.slice(0, -5) + '_original.wav', 'original source');
    return { jsonFile, day: '2025-01-01', entryId: read(jsonFile).entryId };
  });
  let calls = 0;
  const rescue = new AudioRescueService({
    enhance: async (_source, out) => { fs.writeFileSync(out, 'prepared'); return { meanDb: -40, peakDb: -10, durationSec: 3, gainDb: 18, suggestedPreset: 'quiet' }; },
    transcribe: async (_audio, out) => { calls++; fs.writeFileSync(out, JSON.stringify({ text: 'New words', segments: [{ start: 0, end: 2, text: 'New words' }], transcriptionQuality: { version: 1, model: 'large-v3', vadFilter: false, issues: flagged ? [{ kind: 'uncertain', message: 'Listen again' }] : [] } })); if (calls === 1) afterFirstTranscript?.(); },
  });
  const jobFile = path.join(directory, 'batch.json'), deps = { rescue, list: () => files };
  return { files, rescue, jobFile, deps, calls: () => calls, service: new TranscriptionBatchService(jobFile, deps) };
}

test('preview is model-free and paged; review mode retains current text; replacements save provenance and skip on next preview', async () => {
  const t = setup(62), plan = await t.service.preview(scope);
  assert.equal(plan.total, 62); assert.equal(plan.rows.length, 50); assert.equal(t.calls(), 0);
  assert.equal(t.service.snapshot(50).rows.length, 12);
  t.service.start(plan.id, 'review'); await t.service.wait();
  assert.equal(t.service.snapshot().review, 62); assert.equal(t.calls(), 62);
  assert.equal(read(t.files[0].jsonFile).text, 'Old transcript');
  const row = t.service.snapshot().rows[0];
  await t.rescue.apply(row.file, row.candidateId!); await t.service.reviewResult(plan.id, row.candidateId!);
  assert.equal(t.service.snapshot().applied, 1); assert.equal(t.service.snapshot().review, 61);
  assert.equal(read(row.file).transcriptionQuality.batchId, plan.id);
  assert.deepEqual(read(row.file).tags, ['keep']); assert.equal(read(row.file).mayDos[0].status, 'done');
  const next = await t.service.preview(scope); assert.equal(next.skipped, 1);
  assert.equal(t.calls(), 62);
});

test('automatic replacement holds flagged candidates and refresh is explicit', async () => {
  const t = setup(1), plan = await t.service.preview(scope);
  t.service.start(plan.id, 'replace_unflagged'); await t.service.wait(); assert.equal(t.service.snapshot().applied, 1);
  const current = await t.service.preview(scope); assert.equal(current.remaining, 0);
  const refreshed = await t.service.preview({ ...scope, selection: 'all' }); assert.equal(refreshed.remaining, 1);
  const f = setup(1, true), flags = await f.service.preview(scope); f.service.start(flags.id, 'replace_unflagged'); await f.service.wait();
  assert.equal(f.service.snapshot().review, 1); assert.equal(read(f.files[0].jsonFile).text, 'Old transcript');
});

test('stop finishes current work; restart does not launch models; resume reuses candidates and acknowledges acceptance after a crash', async () => {
  const t = setup(3), plan = await t.service.preview(scope);
  t.service.start(plan.id, 'review'); t.service.stop(plan.id); await t.service.wait();
  const saved = read(t.jobFile); saved.state = 'running'; fs.writeFileSync(t.jobFile, JSON.stringify(saved));
  const restarted = new TranscriptionBatchService(t.jobFile, t.deps);
  assert.equal(restarted.snapshot().state, 'interrupted'); const before = t.calls();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(t.calls(), before);
  restarted.resume(plan.id); await restarted.wait(); assert.equal(t.calls(), 3);
  const row = restarted.snapshot().rows[0]; await t.rescue.apply(row.file, row.candidateId!);
  const crash = read(t.jobFile); delete crash.rows[0].outcome; crash.state = 'running'; fs.writeFileSync(t.jobFile, JSON.stringify(crash));
  const resumed = new TranscriptionBatchService(t.jobFile, t.deps); resumed.resume(plan.id); await resumed.wait();
  assert.equal(resumed.snapshot().applied, 1); assert.equal(t.calls(), 3);
});

test('missing sources, changed source, disabled processing, stale IDs and corrupt progress never overwrite entries', async () => {
  const t = setup(3); fs.unlinkSync(t.files[0].jsonFile.slice(0, -5) + '_original.wav');
  const plan = await t.service.preview(scope); assert.equal(plan.skipped, 1);
  fs.appendFileSync(t.files[1].jsonFile.slice(0, -5) + '_original.wav', 'changed');
  assert.throws(() => t.service.start('stale', 'review'), /changed/);
  t.service.start(plan.id, 'replace_unflagged'); await t.service.wait();
  assert.equal(t.service.snapshot().failed, 1); assert.equal(t.service.snapshot().applied, 1);
  assert.equal(read(t.files[1].jsonFile).text, 'Old transcript');
  const disabled = new TranscriptionBatchService(path.join(root, randomUUID()), { ...t.deps, enabled: () => false });
  const preview = await disabled.preview({ ...scope, selection: 'all' }); assert.throws(() => disabled.start(preview.id, 'review'), /Enable/);
  fs.writeFileSync(t.jobFile, '{'); const corrupt = new TranscriptionBatchService(t.jobFile, t.deps);
  await assert.rejects(corrupt.preview(scope), /could not be read/);
});

test('HTTP requires an explicit preview token and validated commands; returns summaries only', async () => {
  const t = setup(1), app = express(); app.use(express.json());
  for (const route of createTranscriptionBatchRoutes(() => t.service)) app[route.method === 'GET' ? 'get' : 'post'](route.path, route.handler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/tools/transcription/batch`;
  try {
    const post = (data: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post({ action: 'start', id: 'made-up', policy: 'review' })).status, 409);
    assert.equal((await post({ action: 'preview', scope: { ...scope, year: '../..' } })).status, 409);
    const response = await post({ action: 'preview', scope }), json = await response.json(); assert.equal(response.status, 200);
    assert.equal(JSON.stringify(json).includes('Old transcript'), false); assert.equal(t.calls(), 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('checkpoint failure stops further model work and recovery reuses the saved candidate', async () => {
  const t = setup(3, false, () => { fs.renameSync(t.jobFile, t.jobFile + '.backup'); fs.mkdirSync(t.jobFile); });
  const plan = await t.service.preview(scope); t.service.start(plan.id, 'review');
  await assert.rejects(t.service.wait(), /could not be saved/);
  assert.equal(t.calls(), 1); assert.equal(t.service.snapshot().state, 'interrupted');
  fs.rmdirSync(t.jobFile); fs.renameSync(t.jobFile + '.backup', t.jobFile);
  const recovered = new TranscriptionBatchService(t.jobFile, t.deps);
  recovered.resume(plan.id); await recovered.wait(); assert.equal(t.calls(), 3); assert.equal(recovered.snapshot().review, 3);
});

test('execution resolves an entry moved after preview by identity and optional cleanup is queued only after acceptance', async () => {
  const t = setup(1), cleaned: string[] = [];
  const service = new TranscriptionBatchService(t.jobFile, { ...t.deps, cleanupEnabled: () => true, cleanup: file => { assert.equal(read(file).text, 'New words'); cleaned.push(file); } });
  const plan = await service.preview(scope), original = t.files[0].jsonFile, moved = original.replace('entry-0.json', 'moved.json');
  fs.renameSync(original, moved); fs.renameSync(original.slice(0,-5) + '_original.wav', moved.slice(0,-5) + '_original.wav'); t.files[0].jsonFile = moved;
  service.start(plan.id, 'replace_unflagged', true); await service.wait();
  assert.equal(service.snapshot().applied, 1); assert.deepEqual(cleaned, [moved]); assert.equal(service.snapshot().rows[0].file, moved);
});

test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
