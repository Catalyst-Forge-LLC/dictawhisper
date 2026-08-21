/**
 * Probe pending journal audio with ffprobe. Marks unreadable files so the
 * watcher skips them.
 *
 *   pnpm audio:probe
 *   pnpm audio:probe --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.ts';
import { audioFileRegex, probeAudioFile } from '../src/lib/audioLib.ts';
import { isSkippedWatchPath } from '../src/lib/fileSettleLib.ts';
import { checkTranscription, recordAudioFailure } from '../src/lib/transcriptionLib.ts';

function walkAudio(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedWatchPath(full)) continue;
      walkAudio(full, out);
      continue;
    }
    if (!audioFileRegex.test(full)) continue;
    if (full.includes('_original') || full.includes('_clean')) continue;
    out.push(full);
  }
}

function main() {
  const apply = process.argv.includes('--apply');
  const files: string[] = [];
  for (const root of config.watch.roots) walkAudio(root, files);

  let pending = 0;
  let bad = 0;
  let marked = 0;
  for (const file of files) {
    const { isProcessed, transcriptionFile } = checkTranscription(file);
    if (isProcessed) continue;
    pending += 1;
    const probe = probeAudioFile(file);
    if (probe.ok) continue;
    bad += 1;
    console.log(`bad  ${probe.reason.padEnd(48)} ${file}`);
    if (!apply) continue;
    recordAudioFailure(transcriptionFile, new Error(`unreadable audio: ${probe.reason}`));
    marked += 1;
  }

  console.log(
    `[audio-probe] ${files.length} audio  pending=${pending} bad=${bad}${apply ? ` marked=${marked}` : ' (dry-run; --apply to mark)'}`,
  );
}

main();
