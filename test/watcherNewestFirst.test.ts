import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { closeAllWatchers, Watcher } from '../src/classes/Watcher.ts';

test('initial scan hands files to the handler newest first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-watch-'));
  fs.writeFileSync(path.join(dir, '2006-01-01_old.mp3'), 'x');
  fs.writeFileSync(path.join(dir, '2025-07-22_new.mp3'), 'x');
  fs.writeFileSync(path.join(dir, '2018-03-03_mid.mp3'), 'x');
  const seen: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('watcher ready timed out')), 8000);
      new Watcher({
        watchFolder: dir,
        watchDepth: 0,
        ignoreCheck: () => false,
        fileMatchRegex: /\.mp3$/i,
        addHandler: async (filePath) => {
          seen.push(path.basename(filePath));
        },
        readyHandler: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
    assert.deepEqual(seen, ['2025-07-22_new.mp3', '2018-03-03_mid.mp3', '2006-01-01_old.mp3']);
  } finally {
    await closeAllWatchers();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
