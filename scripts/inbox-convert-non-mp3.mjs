/**
 * Convert leftover non-MP3 audio inside __inbox via MediaTuna.
 * Does not re-encode existing MP3s. Does not touch the live journal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const INBOX = 'C:\\Users\\acmegeek\\VoiceNotes\\__inbox';
const MEDIATUNA = path.resolve('z:\\workspace\\mediatuna\\index.js');
const CONVERT_EXTS = new Set(['.wav', '.qcp', '.m4a', '.amr', '.aac', '.ogg', '.wma', '.flac']);
const JOBS = 2;

function assertInbox(p) {
  const inbox = path.resolve(INBOX);
  const resolved = path.resolve(p);
  if (resolved !== inbox && !resolved.startsWith(`${inbox}${path.sep}`)) {
    throw new Error(`refusing path outside inbox: ${resolved}`);
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === '__sync') continue;
      walk(full, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (CONVERT_EXTS.has(ext) && !entry.name.startsWith('.')) out.push(full);
  }
}

function convertOne(file) {
  assertInbox(file);
  return new Promise((resolve) => {
    console.log(`[inbox-convert] ${path.relative(INBOX, file)}`);
    const child = spawn(process.execPath, [
      MEDIATUNA,
      file,
      '--audio-only',
      '--prefer-mtime',
      '--log',
      path.join(INBOX, 'mediatuna-convert.log'),
    ], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  assertInbox(INBOX);
  const files = [];
  walk(INBOX, files);
  console.log(`[inbox-convert] ${files.length} non-mp3 files, jobs=${JOBS}`);
  let i = 0;
  let failed = 0;
  const workers = Array.from({ length: JOBS }, async () => {
    while (i < files.length) {
      const file = files[i];
      i += 1;
      const code = await convertOne(file);
      if (code !== 0) failed += 1;
    }
  });
  await Promise.all(workers);
  console.log(`[inbox-convert] done failed=${failed} of ${files.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
