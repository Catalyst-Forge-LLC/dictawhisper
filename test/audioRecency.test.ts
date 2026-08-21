import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioRecencyMs, compareAudioNewestFirst } from '../src/lib/audioLib.ts';

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
