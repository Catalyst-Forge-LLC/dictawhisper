import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MayDoJobStore } from '../src/lib/mayDoJobLib.ts';
import { mayDoExtractionState, mayDoSourceHash, mayDoSummary, mergeMayDos } from '../src/lib/mayDoLib.ts';
import { mayDoCounts, MAY_DO_PRIMARY } from '../src/shared/mayDoState.ts';
import { extractMayDos } from '../src/lib/mayDoService.ts';
import { patchTranscription } from '../src/lib/transcriptionLib.ts';
import { activity, ActivityStore } from '../src/lib/activityLib.ts';
import { retryLabel } from '../client/src/lib/activityState.js';
import type { TranscriptionDocument } from '../src/types/transcription.ts';

const text = 'I should call the dentist tomorrow.';
const candidate = { title: 'Call the dentist', verb: 'call', sourceQuote: text };
const current = () => ({ text, mayDoExtraction: { version: 1, sourceHash: mayDoSourceHash(text), createdAt: new Date().toISOString() } }) as TranscriptionDocument;
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dw-maydo-job-'));

test('shared counts and primary actions agree for full entries and index summaries', () => {
  const rows = ['selected', 'suggested', 'done', 'dismissed'].map((status, i) => ({ ...mergeMayDos([], [candidate], text)[0], id: String(i), status }));
  const summary = mayDoSummary(rows);
  assert.equal(summary.mayDoTotalCount, 4); assert.equal(summary.mayDoActiveCount, 2);
  assert.deepEqual(summary.mayDoStatusCounts, { suggested: 1, selected: 1, done: 1, dismissed: 1 });
  assert.deepEqual(mayDoCounts(summary), mayDoCounts({ mayDos: rows }));
  assert.equal(MAY_DO_PRIMARY.dismissed.status, 'suggested'); assert.equal(MAY_DO_PRIMARY.done.status, 'selected');
});

test('extraction presentation distinguishes none, current, stale source/version, and error', () => {
  assert.equal(mayDoExtractionState({ text } as TranscriptionDocument), 'none');
  assert.equal(mayDoExtractionState(current()), 'current');
  assert.equal(mayDoExtractionState({ ...current(), text: text + ' Changed.' }), 'stale');
  const version = current(); version.mayDoExtraction!.version = 99;
  assert.equal(mayDoExtractionState(version), 'stale');
  assert.equal(mayDoExtractionState({ ...current(), mayDoError: 'offline' }), 'error');
  const dir = temporary(), history = path.join(dir, 'activity.json');
  const store = new ActivityStore(history); store.update(path.join(dir, 'entry.json'), 'extracting_maydos', { hasTranscript: true });
  const restarted = new ActivityStore(history), item = restarted.snapshot().items[0];
  assert.equal(item.stage, 'interrupted'); assert.equal(item.resumeStage, 'extracting_maydos'); assert.equal(retryLabel(item), 'Resume MayDos');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('durable stop finishes current work; explicit resume preserves completed outcomes and retries only errors', async () => {
  const dir = temporary(), file = path.join(dir, 'job.json');
  const calls: string[] = []; let fail = true;
  const read = (name: string) => {
    if (name === '/empty') return { text: '' } as TranscriptionDocument;
    if (name === '/bad') throw new Error('Invalid JSON');
    return { text } as TranscriptionDocument;
  };
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const job = new MayDoJobStore({ file, read, extract: async name => { calls.push(name); if (name === '/a/same.json') await gate; if (name === '/b/same.json' && fail) throw new Error('Model unavailable'); } });
  job.start(['/a/same.json', '/b/same.json', '/empty', '/bad']);
  assert.equal(job.snapshot().current, '/a/same.json'); job.stop(job.snapshot().id); release(); await job.wait();
  assert.equal(job.snapshot().state, 'stopped'); assert.equal(job.snapshot().processed, 1);
  const resumed = new MayDoJobStore({ file, read, extract: async name => { calls.push(name); if (name === '/b/same.json' && fail) throw new Error('Model unavailable'); } });
  assert.equal(calls.length, 1); resumed.resume(resumed.snapshot().id); await resumed.wait();
  assert.deepEqual(calls, ['/a/same.json', '/b/same.json']);
  assert.deepEqual(resumed.snapshot().skipReasons, { current: 0, noTranscript: 1, unreadable: 1 });
  assert.equal(resumed.snapshot().errors[0].file, '/b/same.json');
  fail = false; resumed.resume(resumed.snapshot().id, true); await resumed.wait();
  assert.deepEqual(calls, ['/a/same.json', '/b/same.json', '/b/same.json']);
  assert.equal(resumed.snapshot().failed, 0); assert.equal(resumed.snapshot().processed, 4); assert.equal(resumed.snapshot().updated, 2);
  assert.throws(() => resumed.resume('old-job-id'), /changed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restart marks interrupted without work; resume avoids the sidecar-write/checkpoint crash window even in refresh mode', async () => {
  const dir = temporary(), file = path.join(dir, 'job.json');
  const startedAt = '2020-01-01T00:00:00.000Z';
  fs.writeFileSync(file, JSON.stringify({ version: 1, job: { id: 'restart', state: 'running', scope: { refresh: true, year: '2026' }, entries: [{ file: '/saved' }, { file: '/remaining' }], current: '/saved', startedAt } }));
  const calls: string[] = [];
  const job = new MayDoJobStore({ file, read: name => name === '/saved' ? current() : { text } as TranscriptionDocument, extract: async name => { calls.push(name); } });
  assert.equal(job.snapshot().state, 'interrupted'); assert.deepEqual(calls, []); assert.equal(job.snapshot().scope.year, '2026');
  job.resume('restart'); await job.wait();
  assert.deepEqual(calls, ['/remaining']); assert.equal(job.snapshot().skipReasons.current, 1); assert.equal(job.snapshot().state, 'completed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('storage failure prevents a model call and reports progress durability failure', async () => {
  const dir = temporary(), blocker = path.join(dir, 'blocker'); fs.writeFileSync(blocker, 'file');
  let calls = 0;
  const job = new MayDoJobStore({ file: path.join(blocker, 'job.json'), read: () => ({ text } as TranscriptionDocument), extract: async () => { calls++; } });
  job.start(['/a']); await job.wait();
  assert.equal(calls, 0); assert.equal(job.snapshot().state, 'interrupted'); assert.match(job.snapshot().persistenceError, /could not be saved/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('manual extraction and bulk callers join one operation and conditional undo cannot overwrite a newer decision', async () => {
  const dir = temporary(), file = path.join(dir, 'entry.json');
  fs.writeFileSync(file, JSON.stringify({ text, mayDos: mergeMayDos([], [candidate], text) }));
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const runner = async () => { calls++; await gate; return { mayDos: [candidate] }; };
  const first = extractMayDos(file, runner), second = extractMayDos(process.platform === 'win32' ? file.toUpperCase() : file, runner);
  assert.equal(activity.find(file)?.stage, 'extracting_maydos');
  const id = JSON.parse(fs.readFileSync(file, 'utf8')).mayDos[0].id;
  patchTranscription(file, { mayDo: { id, status: 'selected', expectedStatus: 'suggested' } });
  patchTranscription(file, { mayDo: { id, status: 'done', expectedStatus: 'selected' } });
  assert.throws(() => patchTranscription(file, { mayDo: { id, status: 'suggested', expectedStatus: 'selected' } }), /changed elsewhere/);
  release(); await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).mayDos[0].status, 'done');
  fs.rmSync(dir, { recursive: true, force: true });
});
