import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { dateFromFilename } from '../src/lib/organizationLib.ts';

test('reads year and month from a dated basename', () => {
  assert.deepEqual(dateFromFilename('2026-08-17_09-14-02.m4a'), { year: '2026', month: '08' });
  assert.deepEqual(dateFromFilename(path.join('VoiceNotes', '2026-01-03 note.webm')), {
    year: '2026',
    month: '01',
  });
});

test('returns null when the basename is not dated', () => {
  assert.equal(dateFromFilename('voice-recording.webm'), null);
  assert.equal(dateFromFilename('notes-2026-08-17.mp3'), null);
});
