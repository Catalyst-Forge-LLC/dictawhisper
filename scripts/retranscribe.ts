import fs from 'fs';
import path from 'path';
import { config } from '../src/config.ts';
import { findAudioForSidecar } from '../src/lib/audioLib.ts';
import { isSkippedWatchPath } from '../src/lib/fileSettleLib.ts';
import { ensurePlaybackCues, flattenSegmentWords } from '../src/lib/alignLib.ts';
import { whisperTranscribe } from '../src/lib/whisperLib.ts';
import { cleanTranscription } from '../src/lib/transcriptionLib.ts';

function walkJsonFiles(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedWatchPath(full)) continue;
      walkJsonFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push(full);
  }
}

function hasWordTimestamps(json: { segments?: { words?: unknown }[] }): boolean {
  return flattenSegmentWords(json.segments as any).length > 0;
}

function transcribeOne(audio: string, jsonFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void whisperTranscribe(audio, jsonFile, (payload) => {
      if (payload.err) reject(payload.err);
      else resolve();
    });
  });
}

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const eq = process.argv.find((arg) => arg.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith('-')) return next;
  }
  return undefined;
}

const limitRaw = argValue('--limit');
const limit = limitRaw ? Number(limitRaw) : Infinity;
const force = process.argv.includes('--force');
const reclean = process.argv.includes('--reclean');
const dirArg =
  argValue('--dir') ||
  argValue('--folder') ||
  process.argv.slice(2).find((arg) => !arg.startsWith('-') && arg !== limitRaw);

function recleanOne(jsonFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void cleanTranscription(jsonFile, (err) => {
      if (err) reject(err);
      else resolve();
    }, { reclean: true });
  });
}

function noteSortKey(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const base = path.basename(filePath);
  const inName = base.match(/^(\d{4}-\d{2}-\d{2}(?:[T_ \s]\d{2}[-.]\d{2}[-.]\d{2})?)/);
  if (inName) return `${inName[1].replace(/[T_ \s.]/g, '-')}:${base}`;
  const inPath = norm.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
  if (inPath) return `${inPath[1]}-${inPath[2]}-00:${base}`;
  try {
    return `${new Date(fs.statSync(filePath).mtimeMs).toISOString()}:${base}`;
  } catch {
    return `0000-00-00:${base}`;
  }
}

const defaultRoots = [...config.watch.roots, config.watch.browserDropFolder];
const roots = dirArg ? [path.resolve(dirArg)] : defaultRoots;
for (const root of roots) {
  if (!fs.existsSync(root)) {
    console.error(`[retranscribe] folder not found: ${root}`);
    process.exit(1);
  }
}

const files: string[] = [];
for (const root of roots) {
  if (fs.statSync(root).isFile()) {
    if (root.toLowerCase().endsWith('.json')) files.push(root);
    continue;
  }
  walkJsonFiles(root, files);
}
files.sort((a, b) => noteSortKey(b).localeCompare(noteSortKey(a)));
console.log(
  `[retranscribe] ${files.length} sidecars in ${roots.join(', ')}, newest first` +
    (Number.isFinite(limit) ? `, limit ${limit}` : '')
);

let done = 0;
let skipped = 0;
let failed = 0;

for (const jsonFile of files) {
  if (done >= limit) break;
  let json: { cleanedTranscription?: string; segments?: { words?: unknown }[] };
  try {
    json = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  } catch {
    skipped += 1;
    continue;
  }
  if (!json.cleanedTranscription && !json.segments) {
    skipped += 1;
    continue;
  }
  if (!force && hasWordTimestamps(json)) {
    skipped += 1;
    continue;
  }
  const audio = findAudioForSidecar(jsonFile);
  if (!audio) {
    console.warn(`[retranscribe] no audio for ${jsonFile}`);
    skipped += 1;
    continue;
  }

  console.log(`[retranscribe] ${done + 1} ${audio}`);
  try {
    await transcribeOne(audio, jsonFile);
    if (reclean) await recleanOne(jsonFile);
    const next = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    if (ensurePlaybackCues(next)) {
      fs.writeFileSync(jsonFile, JSON.stringify(next, null, 2), { encoding: 'utf-8' });
    }
    done += 1;
  } catch (error) {
    failed += 1;
    console.error(`[retranscribe] failed ${jsonFile}:`, error);
  }
}

console.log(`[retranscribe] wrote ${done}; skipped ${skipped}; failed ${failed}`);
