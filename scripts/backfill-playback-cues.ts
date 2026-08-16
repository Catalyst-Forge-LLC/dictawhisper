import fs from 'fs';
import path from 'path';
import { config } from '../src/config.ts';
import { ensurePlaybackCues } from '../src/lib/alignLib.ts';
import { isSkippedWatchPath } from '../src/lib/fileSettleLib.ts';

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

const roots = [...config.watch.roots, config.watch.browserDropFolder];
const files: string[] = [];
for (const root of roots) walkJsonFiles(root, files);

let changed = 0;
let skipped = 0;
for (const file of files) {
  let json: { cleanedTranscription?: string; segments?: unknown; playbackCues?: unknown };
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    skipped += 1;
    continue;
  }
  if (!json.cleanedTranscription || !Array.isArray(json.segments)) {
    skipped += 1;
    continue;
  }
  if (!ensurePlaybackCues(json as { cleanedTranscription: string; segments: { start: number; end: number; text: string }[] })) {
    skipped += 1;
    continue;
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2), { encoding: 'utf-8' });
  changed += 1;
  console.log(`[playback-cues] ${file}  ${json.playbackCues?.length ?? 0} cues`);
}

console.log(`[playback-cues] scanned ${files.length}; wrote ${changed}; left ${skipped}`);
