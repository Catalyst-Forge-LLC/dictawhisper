import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { enhanceAudio, enhancementFilter, findOriginalAudio, measureAudio } from '../src/lib/audioEnhancementLib.ts';

test('quiet gain protects peaks, caps amplification, and never attenuates an already loud recording', () => {
  assert.equal(enhancementFilter('quiet', { meanDb: -48, peakDb: -30, durationSec: 2 }).gainDb, 26);
  assert.equal(enhancementFilter('quiet', { meanDb: -48, peakDb: -2, durationSec: 2 }).gainDb, 1);
  assert.equal(enhancementFilter('quiet', { meanDb: -90, peakDb: -80, durationSec: 2 }).gainDb, 30);
  assert.equal(enhancementFilter('quiet', { meanDb: -15, peakDb: 0, durationSec: 2 }).gainDb, 0);
});

test('original lookup finds cross-container originals and never chooses enhanced audio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-original-'));
  try {
    const file = path.join(root, 'note.json');
    fs.writeFileSync(path.join(root, 'note.mp3'), 'working');
    fs.writeFileSync(path.join(root, 'note_original.m4a'), 'original');
    assert.deepEqual(findOriginalAudio(file), { file: path.join(root, 'note_original.m4a'), original: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real FFmpeg presets preserve faint beginnings, duration, source bytes and unclipped output', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-enhancement-'));
  try {
    const source = path.join(root, 'quiet.wav');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=16000', '-af', 'volume=0.01', source], { windowsHide: true });
    assert.equal(made.status, 0, made.stderr?.toString());
    const before = fs.readFileSync(source), initial = await measureAudio(source);
    for (const preset of ['quiet', 'uneven', 'noise', 'original'] as const) {
      const output = path.join(root, `prepared-${preset}.wav`);
      const report = await enhanceAudio(source, output, preset), after = await measureAudio(output);
      assert.ok(Math.abs(after.durationSec - initial.durationSec) < 0.01);
      assert.ok(after.peakDb <= -0.9);
      if (preset === 'quiet') { assert.ok(after.meanDb > initial.meanDb + 20); assert.ok(report.gainDb > 20); }
      if (preset === 'original') assert.equal(after.meanDb, initial.meanDb);
      await assert.rejects(enhanceAudio(source, output, preset), /new file/);
    }
    assert.deepEqual(fs.readFileSync(source), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
