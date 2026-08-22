import fs from 'node:fs';
import path from 'node:path';
import { audioFileRegex, probeAudioFile } from './audioLib.ts';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { checkTranscription, emitNotesIndex, recordAudioFailure } from './transcriptionLib.ts';

export type ProbeHit = { file: string; reason: string };

export type ProbeReport = {
  audio: number;
  pending: number;
  bad: number;
  marked: number;
  files: ProbeHit[];
};

export type ProbeJob = {
  running: boolean;
  apply: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  scanned: number;
  error: string | null;
} & ProbeReport;

const idleJob = (): ProbeJob => ({
  running: false,
  apply: false,
  startedAt: null,
  finishedAt: null,
  scanned: 0,
  error: null,
  audio: 0,
  pending: 0,
  bad: 0,
  marked: 0,
  files: [],
});

let job: ProbeJob = idleJob();

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

export function listWatchAudio(roots: string[]): string[] {
  const files: string[] = [];
  for (const root of roots) walkAudio(root, files);
  return files;
}

export function scanPendingAudio(roots: string[], options: { apply?: boolean } = {}): ProbeReport {
  const apply = Boolean(options.apply);
  const files = listWatchAudio(roots);
  const hits: ProbeHit[] = [];
  let pending = 0;
  let marked = 0;
  for (const file of files) {
    const { isProcessed, transcriptionFile } = checkTranscription(file);
    if (isProcessed) continue;
    pending += 1;
    const probe = probeAudioFile(file);
    if (probe.ok) continue;
    hits.push({ file, reason: probe.reason });
    if (!apply) continue;
    recordAudioFailure(transcriptionFile, new Error(`unreadable audio: ${probe.reason}`));
    marked += 1;
  }
  if (apply && marked) emitNotesIndex();
  return { audio: files.length, pending, bad: hits.length, marked, files: hits };
}

export function getProbeJob(): ProbeJob {
  return { ...job, files: job.files.slice() };
}

export function startProbeJob(roots: string[], options: { apply?: boolean } = {}): ProbeJob {
  if (job.running) return getProbeJob();
  const apply = Boolean(options.apply);
  job = { ...idleJob(), running: true, apply, startedAt: new Date().toISOString() };
  setImmediate(() => {
    try {
      const report = scanPendingAudio(roots, { apply });
      job = {
        ...job,
        ...report,
        running: false,
        finishedAt: new Date().toISOString(),
        scanned: report.pending,
      };
    } catch (error) {
      job = {
        ...job,
        running: false,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return getProbeJob();
}
