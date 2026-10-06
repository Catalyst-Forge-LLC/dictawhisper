import fs from 'node:fs';
import path from 'node:path';
import { audioFileRegex, probeAudioFile } from './audioLib.ts';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { checkTranscription, emitNotesIndex, recordAudioFailure } from './transcriptionLib.ts';
import {resolveAllowedPath} from './pathAllowLib.ts';
import {assertEntryWritable} from './entryOperationLib.ts';
import {activity,isWorkingStage} from './activityLib.ts';

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

export async function scanPendingAudio(roots: string[], options: { apply?: boolean } = {}): Promise<ProbeReport> {
  const apply = Boolean(options.apply);
  const files = listWatchAudio(roots);
  const hits: ProbeHit[] = [];
  let pending = 0;
  let marked = 0;
  for (const file of files) {
    const { isProcessed, transcriptionFile } = checkTranscription(file);
    if (isProcessed) continue;
    pending += 1;
    const probe = await probeAudioFile(file);
    if (probe.ok) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      continue;
    }
    hits.push({ file, reason: probe.reason });
    if (apply) {
      recordAudioFailure(transcriptionFile, new Error(`unreadable audio: ${probe.reason}`));
      marked += 1;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (apply && marked) emitNotesIndex();
  return { audio: files.length, pending, bad: hits.length, marked, files: hits };
}

export function getProbeJob(): ProbeJob {
  return { ...job, files: job.files.slice() };
}
/** Mark only reviewed scan hits, rechecking readability and work state first. */
export async function markReviewedAudio(files: unknown) {
  if (job.running || !job.finishedAt || job.apply || !Array.isArray(files) || !files.length) throw new Error('Finish a check-only scan, then review the files to mark.');
  const known=new Set(job.files.map(row=>row.file));
  for(const requested of files) {
    if(typeof requested!=='string'||!known.has(requested))throw new Error('Every file must be from the current check-only scan.');
    const allowed=resolveAllowedPath(requested);if(!allowed.ok)throw new Error(allowed.error);
  }
  const results=[];
  for(const requested of [...new Set(files)]) {
    if(typeof requested!=='string'||!known.has(requested))throw new Error('Every file must be from the current check-only scan.');
    const allowed=resolveAllowedPath(requested);if(!allowed.ok)throw new Error(allowed.error);
    const {isProcessed,transcriptionFile}=checkTranscription(allowed.path);
    if(isProcessed || isWorkingStage(activity.find(allowed.path)?.stage || 'ready')) {results.push({file:requested,marked:false,reason:'Already processed or processing; kept unchanged.'});continue;}
    assertEntryWritable(allowed.path);assertEntryWritable(transcriptionFile);
    const before=fs.existsSync(allowed.path)?fs.statSync(allowed.path):null;
    const probe=await probeAudioFile(allowed.path);
    assertEntryWritable(allowed.path);assertEntryWritable(transcriptionFile);
    const after=fs.existsSync(allowed.path)?fs.statSync(allowed.path):null;
    if(!before||!after||before.mtimeMs!==after.mtimeMs||before.size!==after.size||checkTranscription(allowed.path).isProcessed||isWorkingStage(activity.find(allowed.path)?.stage||'ready')){results.push({file:requested,marked:false,reason:'File changed or processing started; kept unchanged.'});continue;}
    if(probe.ok){results.push({file:requested,marked:false,reason:'Now readable; kept unchanged.'});continue;}
    recordAudioFailure(transcriptionFile,new Error(`unreadable audio: ${probe.reason}`));results.push({file:requested,marked:true,reason:probe.reason});
  }
  emitNotesIndex();return {ok:true,marked:results.filter(row=>row.marked).length,results};
}

export function startProbeJob(roots: string[], options: { apply?: boolean } = {}): ProbeJob {
  if (job.running) return getProbeJob();
  const apply = Boolean(options.apply);
  job = { ...idleJob(), running: true, apply, startedAt: new Date().toISOString() };
  void (async () => {
    try {
      const report = await scanPendingAudio(roots, { apply });
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
  })();
  return getProbeJob();
}
