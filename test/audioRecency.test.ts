import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioRecencyMs, compareAudioNewestFirst, probeAudioFile } from '../src/lib/audioLib.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('reads recency from a dated basename', () => {
  const newer = audioRecencyMs('2025-07-22_19-29-59My recording 669.mp3');
  const older = audioRecencyMs('MTIME_2006-03-21_12-29-14_Record000.mp3');
  assert.ok(newer > older);
});

test('sorts newest first', () => {
  const files = [
    '2006-03-21_12-29-14_Record000.mp3',
    '2025-07-22_19-29-59_note.mp3',
    '2018-03-03_note.mp3',
  ];
  assert.deepEqual(files.sort(compareAudioNewestFirst), [
    '2025-07-22_19-29-59_note.mp3',
    '2018-03-03_note.mp3',
    '2006-03-21_12-29-14_Record000.mp3',
  ]);
});

test('probe rejects tiny and non-audio files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-probe-'));
  const tiny = path.join(dir, 'tiny.mp3');
  const junk = path.join(dir, 'junk.mp3');
  fs.writeFileSync(tiny, 'ID3');
  fs.writeFileSync(junk, Buffer.alloc(2048, 0));
  assert.equal(probeAudioFile(tiny).ok, false);
  assert.match(probeAudioFile(tiny).reason, /too small/);
  assert.equal(probeAudioFile(junk).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
