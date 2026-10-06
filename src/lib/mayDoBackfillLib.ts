import type { TranscriptionDocument } from '../types/transcription.ts';
import { MAY_DO_VERSION, mayDoSourceHash } from './mayDoLib.ts';

export type MayDoBackfillJob = {
  running: boolean; stopping: boolean; total: number; processed: number;
  updated: number; failed: number; skipped: number; current: string;
  errors: { file: string; error: string }[]; startedAt?: string; finishedAt?: string;
};

export const mayDoSource = (json: TranscriptionDocument) => String(json.cleanedTranscription || json.text || '').trim();

export async function backfillMayDos(
  files: string[], job: MayDoBackfillJob, refresh: boolean,
  read: (file: string) => TranscriptionDocument,
  extract: (file: string) => Promise<unknown>,
) {
  try {
    for (const file of files) {
      if (job.stopping) break;
      job.current = file.replace(/\\/g, '/').split('/').pop() || file;
      try {
        const json = read(file);
        const source = mayDoSource(json);
        const current = !json.mayDoError && json.mayDoExtraction?.version === MAY_DO_VERSION
          && json.mayDoExtraction.sourceHash === mayDoSourceHash(source);
        if (!source || json.audioError || (!refresh && current)) job.skipped++;
        else { await extract(file); job.updated++; }
      } catch (error) {
        job.failed++;
        if (job.errors.length < 100) job.errors.push({ file: job.current, error: error instanceof Error ? error.message : String(error) });
      }
      job.processed++;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally {
    job.running = false;
    job.current = '';
    job.finishedAt = new Date().toISOString();
  }
}
