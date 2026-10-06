import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAY_DO_VERSION, mayDoSourceHash } from './mayDoLib.ts';
import { mayDoSource } from './mayDoBackfillLib.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';

type Outcome = 'updated' | 'current' | 'noTranscript' | 'unreadable' | 'failed';
type RecordItem = { file: string; outcome?: Outcome; error?: string };
export type MayDoJobState = 'idle' | 'running' | 'stopping' | 'completed' | 'stopped' | 'interrupted';
type StoredJob = { id: string; state: MayDoJobState; scope: { year?: string; refresh?: boolean }; entries: RecordItem[]; startedAt?: string; finishedAt?: string; current: string };

/** Persist intent and acknowledged outcomes; construction never starts model work. */
export class MayDoJobStore {
  private job: StoredJob = { id: '', state: 'idle', scope: {}, entries: [], current: '' };
  private file?: string;
  private read: (file: string) => TranscriptionDocument;
  private extract: (file: string) => Promise<unknown>;
  private emit: () => void;
  private task: Promise<void> | null = null;
  persistenceError = '';

  constructor(options: { file?: string; read: (file: string) => TranscriptionDocument; extract: (file: string) => Promise<unknown>; emit?: () => void }) {
    this.file = options.file; this.read = options.read; this.extract = options.extract; this.emit = options.emit || (() => {});
    if (this.file && fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const states = ['idle', 'running', 'stopping', 'completed', 'stopped', 'interrupted'];
        const outcomes = ['updated', 'current', 'noTranscript', 'unreadable', 'failed'];
        if (saved.version !== 1 || typeof saved.job?.id !== 'string' || !states.includes(saved.job?.state) || !saved.job?.scope || !Array.isArray(saved.job?.entries) || !saved.job.entries.every((row: any) => typeof row.file === 'string' && (!row.outcome || outcomes.includes(row.outcome)))) throw new Error('Invalid saved job');
        this.job = saved.job;
        if (['running', 'stopping'].includes(this.job.state)) { this.job.state = 'interrupted'; this.job.current = ''; this.persist(); }
      } catch { this.persistenceError = 'Saved MayDo progress could not be read. Repair the job file before starting another backfill.'; }
    }
  }
  snapshot() {
    const entries = this.job.entries;
    const count = (outcome: Outcome) => entries.filter(row => row.outcome === outcome).length;
    const skipReasons = { current: count('current'), noTranscript: count('noTranscript'), unreadable: count('unreadable') };
    return {
      id: this.job.id, type: 'maydos' as const, state: this.job.state,
      scope: { ...this.job.scope },
      running: ['running', 'stopping'].includes(this.job.state),
      stopping: this.job.state === 'stopping',
      total: entries.length, processed: entries.filter(row => row.outcome).length,
      updated: count('updated'), failed: count('failed'),
      skipped: Object.values(skipReasons).reduce((a, b) => a + b, 0),
      skipReasons, current: this.job.current, currentEntry: this.job.current || undefined,
      errors: entries.filter(row => row.outcome === 'failed').map(row => ({ file: row.file, error: row.error || 'Extraction failed' })),
      startedAt: this.job.startedAt, finishedAt: this.job.finishedAt,
      persistenceError: this.persistenceError,
      remaining: entries.filter(row => !row.outcome).length,
    };
  }
  private persist() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, job: this.job }, null, 2), 'utf8');
      fs.renameSync(temporary, this.file);
      this.persistenceError = '';
    } catch { this.persistenceError = 'MayDo progress could not be saved. Stop and repair storage before continuing; saved actions remain in their entry sidecars.'; }
  }
  private changed() { this.persist(); this.emit(); }
  start(files: string[], scope: { year?: string; refresh?: boolean } = {}) {
    if (this.snapshot().running) throw new Error('A MayDo backfill is already running.');
    if (this.persistenceError) throw new Error(this.persistenceError);
    if (this.snapshot().remaining) throw new Error('Resume or finish the existing backfill before starting a new scope.');
    this.job = { id: randomUUID(), state: 'running', scope: { ...scope }, entries: [...new Set(files)].map(file => ({ file })), startedAt: new Date().toISOString(), current: '' };
    this.launch(); return this.snapshot();
  }
  stop(id?: string) {
    this.checkId(id);
    if (this.snapshot().running) { this.job.state = 'stopping'; this.changed(); }
    return this.snapshot();
  }
  resume(id?: string, failedOnly = false) {
    this.checkId(id);
    if (this.snapshot().running) throw new Error('A MayDo backfill is already running.');
    if (this.persistenceError) throw new Error(this.persistenceError);
    const targets = this.job.entries.filter(row => failedOnly ? row.outcome === 'failed' : !row.outcome || row.outcome === 'failed');
    if (!targets.length) throw new Error(failedOnly ? 'There are no failed entries to retry.' : 'There are no remaining entries to resume.');
    for (const row of targets) { delete row.outcome; delete row.error; }
    this.job.state = 'running'; delete this.job.finishedAt;
    this.launch(new Set(targets.map(row => row.file))); return this.snapshot();
  }
  private checkId(id?: string) { if (id && id !== this.job.id) throw new Error('The backfill changed. Refresh its status before trying again.'); }
  private launch(targets?: Set<string>) {
    this.changed();
    if (this.persistenceError) { this.job.state = 'interrupted'; this.emit(); return; }
    this.task = this.run(targets);
  }
  async wait() { await this.task; }
  private async run(targets?: Set<string>) {
    try {
      for (const row of this.job.entries) {
        if (this.job.state === 'stopping' || this.persistenceError) break;
        if (row.outcome || (targets && !targets.has(row.file))) continue;
        this.job.current = row.file; this.changed();
        if (this.persistenceError) break;
        let json: TranscriptionDocument | null = null;
        try { json = this.read(row.file); if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid entry sidecar'); }
        catch (error) { json = null; row.outcome = 'unreadable'; row.error = error instanceof Error ? error.message : String(error); }
        try {
          if (!json) { this.changed(); await new Promise<void>(resolve => setImmediate(resolve)); continue; }
          const source = mayDoSource(json);
          const current = !json.mayDoError && json.mayDoExtraction?.version === MAY_DO_VERSION && json.mayDoExtraction.sourceHash === mayDoSourceHash(source);
          // A crash can follow the sidecar write but precede the job checkpoint.
          const writtenThisJob = current && String(json.mayDoExtraction?.createdAt) >= String(this.job.startedAt);
          if (json.audioError) row.outcome = 'unreadable';
          else if (!source) row.outcome = 'noTranscript';
          else if (current && (!this.job.scope.refresh || writtenThisJob)) row.outcome = 'current';
          else { await this.extract(row.file); row.outcome = 'updated'; }
        } catch (error) { row.outcome = 'failed'; row.error = error instanceof Error ? error.message : String(error); }
        this.changed();
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    } finally {
      this.job.state = this.persistenceError ? 'interrupted' : this.job.state === 'stopping' ? 'stopped' : this.job.entries.some(row => !row.outcome) ? 'stopped' : 'completed';
      this.job.current = ''; this.job.finishedAt = new Date().toISOString(); this.changed();
    }
  }
}
