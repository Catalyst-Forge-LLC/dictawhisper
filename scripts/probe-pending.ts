/**
 * Probe pending journal audio with ffprobe. Marks unreadable files so the
 * watcher skips them.
 *
 *   pnpm audio:probe
 *   pnpm audio:probe --apply
 */
import { config } from '../src/config.ts';
import { scanPendingAudio } from '../src/lib/audioProbeLib.ts';

const apply = process.argv.includes('--apply');
const report = scanPendingAudio(config.watch.roots, { apply });
for (const hit of report.files) {
  console.log(`bad  ${hit.reason.padEnd(48)} ${hit.file}`);
}
console.log(
  `[audio-probe] ${report.audio} audio  pending=${report.pending} bad=${report.bad}${apply ? ` marked=${report.marked}` : ' (dry-run; --apply to mark)'}`,
);
