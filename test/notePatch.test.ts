import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { test } from 'node:test';
import { patchTranscription } from '../src/lib/transcriptionLib.ts';

test('patchTranscription writes tags and star onto the sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-patch-'));
  const file = path.join(dir, '2026-08-01.json');
  fs.writeFileSync(file, JSON.stringify({ cleanedTranscription: 'hello', tags: ['old'] }));
  const next = patchTranscription(file, { tags: [' Kristen ', 'kristen', 'hope'], starred: true });
  assert.deepEqual(next.transcriptionJson.tags, ['Kristen', 'hope']);
  assert.equal(next.transcriptionJson.starred, true);
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disk.starred, true);
  assert.deepEqual(disk.tags, ['Kristen', 'hope']);
  fs.rmSync(dir, { recursive: true, force: true });
});
