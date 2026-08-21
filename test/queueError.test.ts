import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Queue } from '../src/classes/Queue.ts';
import { checkTranscription, recordAudioFailure } from '../src/lib/transcriptionLib.ts';

test('async processor throw is reported and the queue keeps going', async () => {
  const errors: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('queue did not drain')), 2000);
    const q = new Queue('test', {
      concurrency: 1,
      active: true,
      processor: async () => {
        throw new Error('ffmpeg died');
      },
      onError: (err) => {
        errors.push(err);
      },
      onDrain: () => {
        clearTimeout(timer);
        resolve();
      },
    });
    q.push({});
  });
  assert.match(String(errors[0]), /ffmpeg died/);
});

test('audioError counts as processed so the backlog skips the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-audio-err-'));
  const audio = path.join(dir, 'note.mp3');
  const json = path.join(dir, 'note.json');
  fs.writeFileSync(audio, 'x');
  recordAudioFailure(json, new Error('ffmpeg exited 1: Invalid data'));
  const status = checkTranscription(audio);
  assert.equal(status.transcriptionExists, true);
  assert.equal(status.isProcessed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
