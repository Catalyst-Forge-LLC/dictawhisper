import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { scanPendingAudio } from '../src/lib/audioProbeLib.ts';
import { checkTranscription } from '../src/lib/transcriptionLib.ts';

test('scanPendingAudio finds a zero-byte mp3 and can mark it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-probe-scan-'));
  const audio = path.join(root, '2020-01-01_empty.mp3');
  fs.writeFileSync(audio, '');
  const dry = scanPendingAudio([root], { apply: false });
  assert.equal(dry.pending, 1);
  assert.equal(dry.bad, 1);
  assert.equal(dry.marked, 0);
  assert.match(dry.files[0].reason, /too small/);

  const applied = scanPendingAudio([root], { apply: true });
  assert.equal(applied.marked, 1);
  assert.equal(checkTranscription(audio).isProcessed, true);
  fs.rmSync(root, { recursive: true, force: true });
});
