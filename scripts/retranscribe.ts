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

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
const force = process.argv.includes('--force');
const reclean = process.argv.includes('--reclean');

function recleanOne(jsonFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void cleanTranscription(jsonFile, (err) => {
      if (err) reject(err);
      else resolve();
    }, { reclean: true });
  });
}

const roots = [...config.watch.roots, config.watch.browserDropFolder];
const files: string[] = [];
for (const root of roots) walkJsonFiles(root, files);

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
