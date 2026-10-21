import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioReviewMonitor } from '../client/src/lib/audioReviewState.js';

test('mounted cards share one bounded request and release entries when their last view unmounts', async () => {
  const requests: string[][] = [];
  const monitor = createAudioReviewMonitor(async (files: string[]) => { requests.push(files); return files.map(file => ({ file, pending: [] })); });
  let state: any; const unsubscribe = monitor.subscribe((value: any) => state = value);
  const releases = Array.from({ length: 105 }, (_, i) => monitor.watch(String(i)));
  const duplicate = monitor.watch('0');
  try {
    await monitor.refresh(); assert.deepEqual(requests.map(files => files.length), [100, 5]);
    duplicate(); assert.ok(state['0']); releases[0](); assert.equal(state['0'], undefined);
    requests.length = 0; await monitor.refresh(); assert.equal(requests.flat().includes('0'), false);
  } finally { releases.slice(1).forEach(release => release()); unsubscribe(); }
});

test('failed discovery retains explicit stale status; a successful resolution removes the pending badge', async () => {
  let failure = false, pending: any[] = [{ id: 'candidate' }];
  const monitor = createAudioReviewMonitor(async (files: string[]) => { if (failure) throw Error('offline'); return files.map(file => ({ file, pending })); });
  let state: any; const unsubscribe = monitor.subscribe((value: any) => state = value), release = monitor.watch('entry');
  try {
    await monitor.refresh(); assert.equal(state.entry.pending.length, 1);
    failure = true; await monitor.refresh(); assert.equal(state.entry.pending.length, 1); assert.ok(state.entry.error);
    failure = false; pending = []; await monitor.refresh(); assert.equal(state.entry.pending.length, 0); assert.equal(state.entry.error, undefined);
  } finally { release(); unsubscribe(); }
});

test('a late response cannot restore data after leaving the library', async () => {
  let resolve: (items: any[]) => void = () => {};
  const monitor = createAudioReviewMonitor(() => new Promise<any[]>(done => resolve = done));
  let state: any; const unsubscribe = monitor.subscribe((value: any) => state = value), release = monitor.watch('old');
  const refreshing = monitor.refresh(); release();
  resolve([{ file: 'old', pending: [{ id: 'stale' }] }]); await refreshing;
  assert.deepEqual(state, {}); unsubscribe();
});
