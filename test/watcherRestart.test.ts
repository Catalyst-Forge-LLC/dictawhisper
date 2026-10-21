import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ActivityStore, activity, setActivityStore, type ActivityStage } from '../src/lib/activityLib.ts';
import { config } from '../src/config.ts';
import { initQueues } from '../src/lib/queueLib.ts';
import { initVoiceRootPipeline } from '../src/lib/organizationLib.ts';
import { closeAllWatchers } from '../src/classes/Watcher.ts';

async function until(predicate: () => boolean, message: string) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('restart rechecks pending sync waits, including legacy interrupted waits, but never replays model jobs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-wait-restart-'));
  try {
    const ledger = path.join(root, 'activity.json');
    const before = new ActivityStore(ledger);
    const waiting = before.update(path.join(root, 'waiting.wav'), 'waiting_for_file', { eligibleAt: 1, uploadId: 'saved-upload' });
    const legacy = before.update(path.join(root, 'legacy.wav'), 'interrupted', { resumeStage: 'waiting_for_file', error: 'Server stopped', eligibleAt: 2 });
    const processing: ActivityStage[] = ['queued_transcription', 'transcribing', 'queued_cleanup', 'cleaning', 'extracting_maydos'];
    const jobs = processing.map(stage => before.update(path.join(root, stage + '.wav'), stage));
    const after = new ActivityStore(ledger);
    for (const item of [waiting, legacy]) {
      const restored = after.byId(item.id)!;
      assert.equal(restored.stage, 'waiting_for_file');
      assert.equal(restored.eligibleAt, undefined); // Never trust the saved deadline.
      assert.equal(restored.resumeStage, undefined);
      assert.equal(restored.error, undefined);
    }
    assert.equal(after.byUpload('saved-upload')?.id, waiting.id);
    for (const job of jobs) {
      assert.equal(after.byId(job.id)?.stage, 'interrupted');
      assert.equal(after.byId(job.id)?.resumeStage, job.stage);
    }
    assert.equal(after.snapshot().working, 2);
    assert.equal(after.snapshot().failures, 5);
    after.update(jobs[0].audioFile, 'queued_transcription');
    assert.equal(after.byId(jobs[0].id)?.resumeStage, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real root watcher resumes settled files, waits for fresh writes, and ignores its own preprocessing writes', { timeout: 20_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-watch-restart-'));
  const previous = { store: activity, roots: config.watch.roots, recursive: config.watch.recursiveYears, settle: process.env.VOICE_SETTLE_MS, machine: config.ollanet.machine, required: config.ollanet.required };
  const ledger = path.join(root, '.dictawhisper', 'activity.json');
  const before = new ActivityStore(ledger);
  const make = (name: string, age: number, stage: ActivityStage, legacy = false) => {
    const file = path.join(root, '2026', '10', `2026-10-21_${name}.wav`);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture source');
    const date = new Date(Date.now() - age); fs.utimesSync(file, date, date);
    before.update(file, stage, { eligibleAt: 1, ...(legacy ? { resumeStage: 'waiting_for_file' as const } : {}) });
    return file;
  };
  const settled = make('settled', 10000, 'waiting_for_file');
  const legacy = make('legacy', 10000, 'interrupted', true);
  const changing = make('changing', 0, 'waiting_for_file');
  const interrupted = make('interrupted', 10000, 'transcribing');
  const calls: string[] = [], finishes = new Map<string, () => void>();
  const restarted = new ActivityStore(ledger); setActivityStore(restarted);
  config.watch.roots = [root]; config.watch.recursiveYears = true;
  config.ollanet.machine = ''; config.ollanet.required = false;
  process.env.VOICE_SETTLE_MS = '3000';
  initQueues({ transcription: { active: true, concurrency: 2, processor: (task, done) => {
    calls.push(task.file);
    finishes.set(task.file, () => {
      fs.writeFileSync(task.transcriptionFile, JSON.stringify({ text: 'Fixture speech', cleanupSkipped: true }));
      done(null, { elapsed: 'fixture' });
    });
  } } });
  try {
    initVoiceRootPipeline([root]);
    await until(() => calls.includes(settled) && calls.includes(legacy) && Boolean(restarted.find(changing)?.eligibleAt), 'Initial scan failed to resume the waiting files');
    assert.equal(calls.includes(changing), false);
    assert.equal(calls.includes(interrupted), false);
    assert.equal(restarted.find(interrupted)?.stage, 'interrupted');
    assert.ok(restarted.find(changing)!.eligibleAt! > Date.now());

    // Emulate FFmpeg replacing the working file while the model is still busy.
    fs.appendFileSync(settled, ' prepared');
    fs.appendFileSync(changing, ' still syncing');
    const lastWrite = fs.statSync(changing).mtimeMs;
    await until(() => restarted.find(changing)!.eligibleAt! >= lastWrite + 3000, 'New write did not extend the settle deadline');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(restarted.find(settled)?.stage, 'transcribing');
    assert.equal(calls.filter(file => file === settled).length, 1);
    finishes.get(settled)!(); finishes.get(legacy)!();

    await until(() => calls.includes(changing), 'Reconstructed timer did not submit the now-stable file');
    assert.ok(Date.now() - lastWrite >= 3000);
    finishes.get(changing)!();
    await until(() => restarted.find(changing)?.stage === 'raw_only', 'Completion did not reach Activity');
    assert.equal(calls.length, 3);
    assert.equal(restarted.find(interrupted)?.stage, 'interrupted');
  } finally {
    await closeAllWatchers();
    setActivityStore(previous.store); config.watch.roots = previous.roots; config.watch.recursiveYears = previous.recursive;
    config.ollanet.machine = previous.machine; config.ollanet.required = previous.required;
    if (previous.settle === undefined) delete process.env.VOICE_SETTLE_MS; else process.env.VOICE_SETTLE_MS = previous.settle;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
