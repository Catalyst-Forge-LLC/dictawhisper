import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentDisposition } from '../src/lib/downloadLib.ts';

test('quotes the basename and keeps spaces for download', () => {
  const header = contentDisposition('C:\\VoiceNotes\\2011\\01\\2025-09-12 18-35-14My recording 14.mp3', 'attachment');
  assert.match(header, /^attachment;/);
  assert.match(header, /filename="2025-09-12 18-35-14My recording 14\.mp3"/);
  assert.match(header, /filename\*=UTF-8''2025-09-12%2018-35-14My%20recording%2014\.mp3/);
});
