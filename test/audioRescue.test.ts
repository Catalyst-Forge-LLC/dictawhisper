import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { config } from '../src/config.ts';
import { AudioRescueService } from '../src/lib/audioRescueService.ts';
import { audioRescueRoutes } from '../src/audioRescueRoutes.ts';
import { findAudioForSidecar } from '../src/lib/audioLib.ts';
import { isSkippedWatchPath } from '../src/lib/fileSettleLib.ts';
import { patchTranscription } from '../src/lib/transcriptionLib.ts';
import { moveEntryBundle, moveToTrash, restoreTrash, entryBundleFiles, purgeTrash } from '../src/lib/entryBundleLib.ts';
import { ActivityStore, setActivityStore } from '../src/lib/activityLib.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-rescue-'));
config.watch.roots = [root]; config.watch.browserDropFolder = root;
config.journal.index = path.join(root, 'journal.sqlite'); config.journal.embedModel = ''; config.journal.search = 'lex';
config.ollanet.machine = ''; config.queues.transcription.active = true;
setActivityStore(new ActivityStore());
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
function makeEntry() {
  const file = path.join(root, randomUUID() + '.json');
  fs.writeFileSync(file, JSON.stringify({ text: 'Old words', segments: [{ start: 0, end: 1, text: 'Old words' }], cleanedTranscription: 'Old readable words', tags: ['kept'], starred: true, displayTitle: 'My title', mayDos: [{ id: 'todo', title: 'Remember', sourceQuote: 'Old words', start: 0, end: 1, status: 'selected' }] }));
  fs.writeFileSync(file.slice(0, -5) + '.mp3', 'old working audio');
  fs.writeFileSync(file.slice(0, -5) + '_original.m4a', 'original bytes');
  return file;
}
const options = { preset: 'quiet', model: 'large-v3', vadFilter: false };
const service = () => new AudioRescueService({
  enhance: async (source, output) => { assert.equal(fs.readFileSync(source, 'utf8'), 'original bytes'); fs.writeFileSync(output, 'new audio'); return { meanDb: -40, peakDb: -25, durationSec: 4, gainDb: 18, suggestedPreset: 'quiet' }; },
  transcribe: async (_audio, output, model, vad) => { assert.equal(model, 'large-v3'); assert.equal(vad, false); fs.writeFileSync(output, JSON.stringify({ text: 'Recovered words', segments: [{ start: 1, end: 3, text: 'Recovered words' }], whisper: { model, vad_filter: vad } })); },
});
async function ready(svc: AudioRescueService, file: string) {
  const id = svc.prepare(file, options).job!.id; await svc.wait(id);
  assert.equal(svc.status(file, id).job!.phase, 'preview');
  svc.transcribe(file, id); await svc.wait(id);
  const candidate = svc.status(file, id).job!;
  assert.equal(candidate.phase, 'ready');
  assert.deepEqual(candidate.segments, [{start:1,end:3,text:'Recovered words'}], 'review context comes from the candidate, not the current transcript');
  return id;
}

test('normal imports share preparation and preserve originals, sidecar metadata and recovery history', async () => {
  const svc = service(), file = makeEntry();
  await svc.importAudio(file.slice(0, -5) + '.mp3', file, 'large-v3');
  const json = read(file);
  assert.equal(json.text, 'Recovered words'); assert.equal(json.starred, true); assert.equal(json.displayTitle, 'My title');
  assert.equal(json.cleanedTranscription, undefined); assert.equal(json.cleanupSkipped, undefined, 'normal imports proceed to cleanup');
  assert.equal(read(file).mayDos[0].status, 'selected');
  assert.equal(fs.readFileSync(file.slice(0, -5) + '_original.m4a', 'utf8'), 'original bytes');
  assert.equal(svc.status(file).job!.phase, 'applied');
  await svc.restore(file, json.audioEnhancement.versionId); assert.equal(read(file).text, 'Old words');
});

test('first import cannot Undo into an empty, invalid sidecar', async () => {
  const svc = service(), file = makeEntry(); fs.unlinkSync(file);
  await svc.importAudio(file.slice(0, -5) + '.mp3', file, 'large-v3');
  const status = svc.status(file);
  assert.equal(status.canUndo, false);
  await assert.rejects(svc.restore(file, status.job!.id), /first transcript/);
  assert.equal(read(file).text, 'Recovered words');
});

test('preview/candidate isolation, current human decisions, timed audio swap, idempotence and Undo', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file);
  assert.equal(read(file).text, 'Old words'); assert.equal(read(file).cleanedTranscription, 'Old readable words');
  patchTranscription(file, { tags: ['edited'], displayTitle: 'New title', starred: false, mayDo: { id: 'todo', status: 'done' } });
  await svc.apply(file, id); await svc.apply(file, id);
  const json = read(file); assert.equal(json.text, 'Recovered words'); assert.equal(json.cleanedTranscription, undefined);
  assert.deepEqual(json.tags, ['edited']); assert.equal(json.displayTitle, 'New title'); assert.equal(json.starred, false);
  assert.equal(json.mayDos[0].status, 'done'); assert.equal(json.mayDos[0].start, null);
  assert.equal(fs.readFileSync(findAudioForSidecar(file)!, 'utf8'), 'new audio');
  assert.equal(isSkippedWatchPath(findAudioForSidecar(file)!), true);
  assert.equal(fs.readFileSync(file.slice(0, -5) + '_original.m4a', 'utf8'), 'original bytes');
  patchTranscription(file, { tags: ['latest'] }); await svc.restore(file, id); await svc.restore(file, id);
  assert.equal(read(file).text, 'Old words'); assert.equal(read(file).cleanedTranscription, 'Old readable words');
  assert.deepEqual(read(file).tags, ['latest']); assert.equal(read(file).mayDos[0].status, 'done'); assert.equal(read(file).mayDos[0].start, 0);
  assert.equal(fs.readFileSync(findAudioForSidecar(file)!, 'utf8'), 'old working audio');
});

test('entry moves and Trash carry enhanced audio; history resolves by identity after restore', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file); await svc.apply(file, id);
  const movedFile = path.join(root, 'moved', path.basename(file));
  await moveEntryBundle(file, movedFile);
  assert.equal(entryBundleFiles(movedFile).length, 4);
  const receipt = await moveToTrash(movedFile), restored = await restoreTrash(receipt.trashId);
  assert.equal(fs.readFileSync(findAudioForSidecar(restored.jsonFile)!, 'utf8'), 'new audio');
  assert.equal(svc.status(restored.jsonFile).activeVersionId, id);
  await svc.restore(restored.jsonFile, id); assert.equal(read(restored.jsonFile).text, 'Old words');
});

test('stale transcript acceptance and Undo after new cleanup preserve newer work', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file);
  const fresh = read(file); fresh.text = 'New external words'; fs.writeFileSync(file, JSON.stringify(fresh));
  await assert.rejects(svc.apply(file, id), /changed/); assert.equal(read(file).text, 'New external words');
  const next = await ready(svc, file); await svc.apply(file, next);
  const edited = read(file); edited.cleanedTranscription = 'New cleanup'; fs.writeFileSync(file, JSON.stringify(edited));
  await assert.rejects(svc.restore(file, next), /newer work/); assert.equal(read(file).cleanedTranscription, 'New cleanup');
});

test('reviewing changed current text permits explicit replacement and Undo preserves the reviewed version', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file);
  const initial = svc.status(file, id);
  const latest = read(file); latest.cleanedTranscription = 'Cleanup completed after candidate preparation.';
  fs.writeFileSync(file, JSON.stringify(latest));
  await assert.rejects(svc.apply(file, id), /changed/);
  await assert.rejects(svc.apply(file, id, initial.reviewToken), /changed/);
  const reviewed = svc.status(file, id);
  assert.equal(reviewed.currentChanged, true);
  assert.equal(reviewed.currentReadableText, latest.cleanedTranscription);
  assert.notEqual(reviewed.reviewToken, initial.reviewToken);
  // Human organization changes still survive an already-open review.
  patchTranscription(file, { tags: ['latest tag'] });
  await svc.apply(file, id, reviewed.reviewToken);
  assert.equal(read(file).text, 'Recovered words');
  await svc.restore(file, id);
  assert.equal(read(file).cleanedTranscription, latest.cleanedTranscription);
  assert.deepEqual(read(file).tags, ['latest-tag']);
  const manifest = path.join(root, '.dictawhisper', 'audio-improvements', id, 'job.json');
  const receipt = read(manifest); receipt.phase = 'applied'; fs.writeFileSync(manifest, JSON.stringify(receipt));
  assert.equal(service().status(file, id).job!.phase, 'reverted', 'reconcile an interrupted Undo to the reviewed baseline');
});

test('review tokens reject further transcript changes, invalid tokens and changes while audio is copied', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file);
  const reviewed = svc.status(file, id);
  await assert.rejects(svc.apply(file, id, 'bad token'), /Refresh/);
  const copy = fs.promises.copyFile;
  fs.promises.copyFile = async (...args) => {
    await copy(...args);
    const latest = read(file); latest.text = 'Changed during audio copy'; fs.writeFileSync(file, JSON.stringify(latest));
  };
  try { await assert.rejects(svc.apply(file, id, reviewed.reviewToken), /changed while audio/); }
  finally { fs.promises.copyFile = copy; }
  assert.equal(read(file).text, 'Changed during audio copy');
  assert.equal(svc.status(file, id).job!.phase, 'ready');
  await assert.rejects(svc.apply(file, id, reviewed.reviewToken), /changed/);
});

test('lightweight candidate discovery survives restart and moves, omits transcript text, and clears resolved versions', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file);
  const manifest = path.join(root, '.dictawhisper', 'audio-improvements', id, 'job.json');
  const job = read(manifest); job.createdAt = '2020-01-01T00:00:00.000Z'; fs.writeFileSync(manifest, JSON.stringify(job));
  const next = await ready(svc, file);
  const restarted = service();
  assert.deepEqual(restarted.summary(file).pending.map(row => row.id), [next, id]);
  assert.equal(JSON.stringify(restarted.summary(file)).includes('Recovered words'), false);
  const candidatePath = path.join(root, '.dictawhisper', 'audio-improvements', next, 'candidate.json');
  const candidate = fs.readFileSync(candidatePath); fs.writeFileSync(candidatePath, 'not JSON');
  assert.equal(restarted.summary(file).pending.length, 2, 'discovery does not load candidate text');
  fs.writeFileSync(candidatePath, candidate);
  const moved = path.join(root, 'moved', path.basename(file)); await moveEntryBundle(file, moved);
  assert.equal(restarted.summary(moved).pending.length, 2);
  await restarted.apply(moved, next); assert.equal(restarted.summary(moved).pending.length, 0);
  await restarted.restore(moved, next); assert.equal(restarted.summary(moved).pending.length, 1);
  restarted.discard(moved, id); assert.equal(restarted.summary(moved).pending.length, 0);
});

test('confirmed permanent deletion also removes saved candidate audio and transcript history', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file); await svc.apply(file, id);
  const stored = path.join(root, '.dictawhisper', 'audio-improvements', id);
  const receipt = await moveToTrash(file);
  assert.ok(fs.existsSync(stored));
  purgeTrash(receipt.trashId, 'DELETE AUDIO AND TRANSCRIPT');
  assert.equal(fs.existsSync(stored), false);
});

test('interrupted and empty-transcript attempts are recoverable without modifying current text', async () => {
  const svc = service(), file = makeEntry(), id = await ready(svc, file);
  const manifest = path.join(root, '.dictawhisper', 'audio-improvements', id, 'job.json');
  const job = read(manifest); job.phase = 'transcribing'; fs.writeFileSync(manifest, JSON.stringify(job));
  const restarted = service(); assert.equal(restarted.status(file, id).job!.phase, 'failed');
  restarted.transcribe(file, id); await restarted.wait(id); assert.equal(restarted.status(file, id).job!.phase, 'ready');
  const failed = new AudioRescueService({ enhance: async (_source, output) => { fs.writeFileSync(output, 'audio'); return { meanDb: -40, peakDb: -25, durationSec: 4, gainDb: 18, suggestedPreset: 'quiet' }; }, transcribe: async (_a, out) => { fs.writeFileSync(out, JSON.stringify({ text: '', segments: [] })); } });
  const badId = failed.prepare(file, options).job!.id; await failed.wait(badId); failed.transcribe(file, badId); await failed.wait(badId);
  assert.match(failed.status(file, badId).job!.error!, /No usable/); assert.equal(read(file).text, 'Old words');
  failed.discard(file, badId); assert.equal(failed.status(file, badId).job!.phase, 'discarded');
});

test('per-entry bindings, missing playback, durable receipt reconciliation, and unsafe storage paths', async () => {
  const svc = service(), file = makeEntry(), other = makeEntry(), id = await ready(svc, file);
  assert.throws(() => svc.status(other, id), /not found/);
  await assert.rejects(svc.apply(other, id), /does not belong/);
  await svc.apply(file, id);
  const manifest = path.join(root, '.dictawhisper', 'audio-improvements', id, 'job.json'), saved = read(manifest);
  saved.phase = 'ready'; delete saved.acceptedFingerprint; fs.writeFileSync(manifest, JSON.stringify(saved));
  assert.equal(svc.status(file, id).job!.phase, 'applied');
  const audio = findAudioForSidecar(file)!; fs.renameSync(audio, audio + '.tmp');
  assert.equal(findAudioForSidecar(file), null); fs.renameSync(audio + '.tmp', audio);
  const redirected = randomUUID(); fs.symlinkSync(root, path.join(root, '.dictawhisper', 'audio-improvements', redirected), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => svc.status(file), /redirects/);
  fs.unlinkSync(path.join(root, '.dictawhisper', 'audio-improvements', redirected));
});

test('HTTP rejects out-of-root paths and invalid presets without starting a model', async () => {
  const app = express(); app.use(express.json());
  for (const route of audioRescueRoutes) app[route.method === 'GET' ? 'get' : 'post'](route.path, route.handler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/notes/audio-improvement`;
  try {
    const blocked = await fetch(base + '?file=' + encodeURIComponent(path.join(root, '..', 'outside.json'))); assert.equal(blocked.status, 403);
    const invalid = await fetch(base + '/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: makeEntry(), ...options, preset: 'shell injection' }) });
    assert.equal(invalid.status, 409); assert.match((await invalid.json()).error, /supported audio preset/);
    const file = makeEntry(), outside = path.join(root, '..', 'outside.json');
    const summaries = await fetch(base + '/summaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [file, outside, file] }) });
    const rows = (await summaries.json()).items;
    assert.equal(rows.length, 2); assert.deepEqual(rows[0].pending, []); assert.ok(rows[1].error);
    const overflow = await fetch(base + '/summaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: Array(101).fill(file) }) });
    assert.equal(overflow.status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });
