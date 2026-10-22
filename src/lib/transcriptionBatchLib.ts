import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { audioRescue, type AudioRescueService } from './audioRescueService.ts';
import { findOriginalAudio } from './audioEnhancementLib.ts';
import { TRANSCRIPTION_PIPELINE_VERSION } from './transcriptionQualityLib.ts';
import { resolveAllowedPath } from './pathAllowLib.ts';
import { isSkippedWatchPath, inspectFileReadiness } from './fileSettleLib.ts';
import { activity, isWorkingStage } from './activityLib.ts';
import { listInboxNotes } from './journalService.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';
import { requestCleanup } from './transcriptionLib.ts';
import { q } from './queueLib.ts';
import { ollanetIsConfigured } from './ollanetReadyLib.ts';
import { assertEntryWritable } from './entryOperationLib.ts';
import {isTranscriptionModel, type TranscriptionModel} from './asrModels.ts';
import {barkAvailability} from './barkLib.ts';

export type BatchScope = { year: string; selection: 'outdated' | 'flagged' | 'all'; model: TranscriptionModel };
type Policy = 'review' | 'replace_unflagged';
type State = 'idle' | 'preview' | 'running' | 'stopping' | 'stopped' | 'interrupted' | 'completed';
type Outcome = 'current' | 'unavailable' | 'review' | 'applied' | 'failed';
type Row = { file: string; entryId?: string; title: string; source?: { size: number; mtimeMs: number }; candidateId?: string; outcome?: Outcome; note?: string };
type Job = { version: 1; id: string; state: State; scope: BatchScope; policy: Policy; cleanup?: boolean; rows: Row[]; current: string; createdAt?: string; finishedAt?: string };
type Dependencies = { rescue: AudioRescueService; list: () => { jsonFile: string; day?: string; entryId?: string }[]; modelIssue: (model: string) => string; enabled: () => boolean; cleanupEnabled: () => boolean; cleanup: (file: string) => void; emit: () => void };
const read = (file: string): TranscriptionDocument => JSON.parse(fs.readFileSync(file, 'utf8'));
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const yieldLoop = () => new Promise<void>(resolve => setImmediate(resolve));
function checked(file: string) {
  const result = resolveAllowedPath(file);
  if (!result.ok) throw new Error(result.error);
  if (isSkippedWatchPath(result.path)) throw new Error('This entry is no longer in the active library.');
  return result.path;
}
function sourceInfo(file: string) {
  const source = findOriginalAudio(file);
  if (!source) throw new Error('No source audio is available next to this entry.');
  const audio = checked(source.file), stat = fs.statSync(audio);
  return { file: audio, original: source.original, size: stat.size, mtimeMs: stat.mtimeMs };
}
export function currentPipeline(json: TranscriptionDocument, source: { size: number; mtimeMs: number }, model: string) {
  const q = json.transcriptionQuality;
  return !json.audioError && q?.version === TRANSCRIPTION_PIPELINE_VERSION && q.model === model && q.vadFilter === false && q.source?.size === source.size && q.source?.mtimeMs === source.mtimeMs;
}

/** One explicit, durable batch. Neither construction nor preview starts FFmpeg/ASR. */
export class TranscriptionBatchService {
  private job: Job = { version: 1, id: '', state: 'idle', scope: { year: '', selection: 'outdated', model: config.transcription.model }, policy: 'review', rows: [], current: '' };
  private deps: Dependencies;
  private task: Promise<void> | null = null;
  private planning = false;
  persistenceError = '';
  constructor(privateFile: string, deps: Partial<Dependencies> = {}) {
    this.file = privateFile;
    this.deps = { rescue: audioRescue, modelIssue: model => model === 'bark-pro' ? barkAvailability().reason : '', list: () => listInboxNotes({ all: true, folder: 'active' }), enabled: () => config.queues.transcription.active, cleanupEnabled: () => ollanetIsConfigured() && Boolean(q.processing), cleanup: file => { requestCleanup(file); }, emit: () => {}, ...deps };
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Job;
        if (saved.version !== 1 || typeof saved.id !== 'string' || !['idle', 'preview', 'running', 'stopping', 'stopped', 'interrupted', 'completed'].includes(saved.state) || !Array.isArray(saved.rows) || !saved.rows.every(row => typeof row.file === 'string' && typeof row.title === 'string' && (!row.outcome || ['current', 'unavailable', 'review', 'applied', 'failed'].includes(row.outcome))) || !['review', 'replace_unflagged'].includes(saved.policy)) throw new Error('Invalid saved batch');
        this.validateScope(saved.scope); this.job = saved;
        if (['running', 'stopping'].includes(saved.state)) { this.job.state = 'interrupted'; this.job.current = ''; this.persist(); }
      } catch { this.persistenceError = 'Saved retranscription progress could not be read. Repair the batch file before starting another batch.'; }
    }
  }
  private file: string;
  private validateScope(value: BatchScope) {
    if (!value || !/^(\d{4})?$/.test(value.year) || !['outdated', 'flagged', 'all'].includes(value.selection) || !isTranscriptionModel(value.model)) throw new Error('Choose a valid year, selection and model.');
  }
  private persist() {
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(this.job), { flag: 'wx' }); fs.renameSync(temp, this.file); this.persistenceError = '';
    } catch { this.persistenceError = 'Batch progress could not be saved. Processing stopped; candidates and existing entries are retained.'; throw new Error(this.persistenceError); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    this.deps.emit();
  }
  snapshot(offset = 0, filter = 'all') {
    const count = (outcome: Outcome) => this.job.rows.filter(row => row.outcome === outcome).length;
    const rows = this.job.rows.filter(row => filter === 'all' || (filter === 'work' ? !row.outcome || ['review','applied','failed'].includes(row.outcome) : row.outcome === filter));
    const safeOffset = Math.max(0, Math.min(Number.isFinite(offset) ? Math.floor(offset) : 0, Math.floor(Math.max(0, rows.length - 1) / 50) * 50));
    return { id: this.job.id, state: this.job.state, scope: this.job.scope, defaultModel: config.transcription.model, modelIssue: this.deps.modelIssue(this.job.scope.model), policy: this.job.policy, planning: this.planning,
      running: ['running', 'stopping'].includes(this.job.state), enabled: this.deps.enabled(), cleanupEnabled: this.deps.cleanupEnabled(), cleanup: this.job.cleanup, current: this.job.current,
      total: this.job.rows.length, remaining: this.job.rows.filter(row => !row.outcome).length, applied: count('applied'), review: count('review'), failed: count('failed'), skipped: count('current') + count('unavailable'),
      createdAt: this.job.createdAt, finishedAt: this.job.finishedAt, persistenceError: this.persistenceError,
      rows: rows.slice(safeOffset, safeOffset + 50).map(row => ({ file: row.file, title: row.title, outcome: row.outcome || 'pending', note: row.note, candidateId: row.candidateId })), offset: safeOffset, filteredTotal: rows.length };
  }
  summary() { const { rows, offset, filteredTotal, ...summary } = this.snapshot(); return summary; }
  async preview(scope: BatchScope) {
    this.validateScope(scope);
    if (this.planning || this.snapshot().running || (this.job.state !== 'preview' && this.snapshot().remaining)) throw new Error('Finish or resume the current batch before previewing another scope.');
    if (this.persistenceError) throw new Error(this.persistenceError);
    this.planning = true;
    try {
      const rows: Row[] = [];
      const files = this.deps.list().filter(note => !scope.year || note.day?.startsWith(scope.year + '-'));
      const seen = new Set<string>();
      for (const note of files) {
        if (seen.has(note.jsonFile)) continue; seen.add(note.jsonFile);
        const row: Row = { file: note.jsonFile, title: path.basename(note.jsonFile, '.json') };
        try {
          row.file = checked(row.file); const json = read(row.file);
          row.entryId = json.entryId; row.title = json.displayTitle || row.title;
          if (scope.selection === 'flagged' && !json.audioError && !json.transcriptionQuality?.issues.length) continue;
          const source = sourceInfo(row.file); row.source = { size: source.size, mtimeMs: source.mtimeMs };
          if (scope.selection === 'outdated' && currentPipeline(json, source, scope.model)) { row.outcome = 'current'; row.note = 'Already uses this pipeline/model and unchanged source metadata.'; }
          else if (!source.original) row.note = 'Using available audio; no separate original was found.';
        } catch (error) { row.outcome = 'unavailable'; row.note = errorText(error); }
        rows.push(row); if (rows.length % 50 === 0) await yieldLoop();
      }
      // Keep the last manifest when changing scope; per-entry candidates/history remain discoverable.
      if (this.job.id && this.job.state !== 'preview') fs.copyFileSync(this.file, this.file + '.' + this.job.id + '.history.json', fs.constants.COPYFILE_EXCL);
      this.job = { version: 1, id: randomUUID(), state: 'preview', scope: { ...scope }, policy: 'review', rows, current: '', createdAt: new Date().toISOString() };
      this.persist(); return this.snapshot();
    } finally { this.planning = false; }
  }
  private check(id: string) { if (!id || id !== this.job.id) throw new Error('This batch changed. Refresh its preview or progress.'); if (this.persistenceError) throw new Error(this.persistenceError); }
  start(id: string, policy: Policy, cleanup = false) {
    this.check(id);
    if (this.job.state !== 'preview') { if (this.snapshot().running && this.job.policy === policy) return this.snapshot(); throw new Error('Preview this scope before starting.'); }
    if (!['review', 'replace_unflagged'].includes(policy)) throw new Error('Choose how candidates should be saved.');
    if (!this.snapshot().remaining) throw new Error('There are no eligible recordings in this preview.');
    if (!this.deps.enabled()) throw new Error('Enable transcription in Settings before starting this batch.');
    if (this.deps.modelIssue(this.job.scope.model)) throw new Error(this.deps.modelIssue(this.job.scope.model));
    if (cleanup && !this.deps.cleanupEnabled()) throw new Error('Readable processing is unavailable. Enable its queue/model, or start with original transcripts only.');
    this.job.policy = policy; this.job.cleanup = cleanup; this.launch(); return this.snapshot();
  }
  stop(id: string) { this.check(id); if (this.snapshot().running) { this.job.state = 'stopping'; this.persist(); } return this.snapshot(); }
  async reviewResult(id: string, candidateId: string) {
    this.check(id);
    const row = this.job.rows.find(item => item.candidateId === candidateId);
    if (!row || !['review', 'applied'].includes(row.outcome || '')) throw new Error('This candidate is not a completed item in this batch.');
    await this.resolveRow(row);
    const result = this.deps.rescue.status(row.file, candidateId);
    if (result.job?.phase === 'applied') { row.outcome = 'applied'; row.note = 'New version accepted.'; }
    if (['reverted', 'discarded'].includes(result.job?.phase || '')) { row.outcome = 'current'; row.note = 'Kept the previous version.'; }
    this.persist(); return this.snapshot();
  }
  resume(id: string, failedOnly = false) {
    this.check(id);
    if (this.snapshot().running || this.job.state === 'preview') throw new Error('This batch is already running or has not been started.');
    if (!this.deps.enabled()) throw new Error('Enable transcription in Settings before resuming.');
    if (this.deps.modelIssue(this.job.scope.model)) throw new Error(this.deps.modelIssue(this.job.scope.model));
    const targets = new Set(this.job.rows.filter(row => failedOnly ? row.outcome === 'failed' : !row.outcome || row.outcome === 'failed'));
    if (!targets.size) throw new Error('There is nothing left to resume.');
    for (const row of targets) { delete row.outcome; delete row.note; }
    this.launch(targets); return this.snapshot();
  }
  private launch(targets?: Set<Row>) {
    this.job.state = 'running'; delete this.job.finishedAt; this.persist();
    this.task = this.run(targets); void this.task.catch(error => { this.persistenceError ||= errorText(error); });
  }
  async wait() { await this.task; }
  private followWithCleanup(row: Row) {
    if (!this.job.cleanup || read(row.file).cleanedTranscription) return;
    try { this.deps.cleanup(row.file); row.note = 'Replaced; readable text, tags and MayDos queued in Activity.'; }
    catch (error) { row.note = 'Replaced; readable processing needs attention: ' + errorText(error); }
  }
  private async resolveRow(row: Row) {
    if (!fs.existsSync(row.file) && row.entryId) {
      const moved = this.deps.list().find(note => note.entryId === row.entryId);
      if (moved) row.file = moved.jsonFile;
    }
    row.file = checked(row.file);
    const json = read(row.file);
    if (row.entryId && json.entryId !== row.entryId) throw new Error('A different entry now occupies this path. Preview it again.');
    return json;
  }
  private async run(targets?: Set<Row>) {
    try {
      for (const row of this.job.rows) {
        if (this.job.state === 'stopping' || this.persistenceError) break;
        if (row.outcome || targets && !targets.has(row)) continue;
        if (!this.deps.enabled()) { this.job.state = 'stopping'; break; }
        this.job.current = row.title; this.persist();
        try {
          const json = await this.resolveRow(row), source = sourceInfo(row.file);
          // A crash may follow acceptance but precede the batch receipt.
          if (row.candidateId && json.audioEnhancement?.versionId === row.candidateId) { row.outcome = 'applied'; this.followWithCleanup(row); this.persist(); continue; }
          if (this.job.scope.selection === 'outdated' && currentPipeline(json, source, this.job.scope.model)) { row.outcome = 'current'; this.persist(); continue; }
          if (!row.source || source.size !== row.source.size || source.mtimeMs !== row.source.mtimeMs) throw new Error('Source changed after preview. Finish this batch and preview the changed entry again.');
          const readiness = inspectFileReadiness(source.file);
          if (!readiness.ready) throw new Error('Source is still syncing: ' + readiness.reason);
          if (isWorkingStage(activity.find(row.file)?.stage || 'ready')) throw new Error('Entry is processing elsewhere. Retry this failed item after it finishes.');
          assertEntryWritable(row.file);
          let state = row.candidateId ? this.deps.rescue.status(row.file, row.candidateId) : null;
          if (!state || state.job?.phase === 'failed' && state.job.failedStage === 'preparing') {
            state = this.deps.rescue.prepare(row.file, { preset: 'auto', model: this.job.scope.model, vadFilter: false });
            if (state.job?.preset !== 'auto' || state.job.model !== this.job.scope.model || state.job.vadFilter !== false) throw new Error('Another audio attempt is running with different settings. Retry after it finishes.');
            row.candidateId = state.job!.id; row.entryId = state.job!.entryId; this.persist();
            await this.deps.rescue.wait(row.candidateId);
            state = this.deps.rescue.status(row.file, row.candidateId);
          }
          if (state.job?.phase === 'preview' || state.job?.phase === 'failed' && state.job.failedStage === 'transcribing') {
            this.deps.rescue.transcribe(row.file, row.candidateId!); await this.deps.rescue.wait(row.candidateId!);
            state = this.deps.rescue.status(row.file, row.candidateId);
          }
          if (state.job?.phase !== 'ready') throw new Error(state.job?.error || 'The saved candidate is unavailable. Open the entry to inspect its attempt.');
          this.deps.rescue.markBatch(row.file, row.candidateId!, this.job.id);
          const issues = state.job.quality?.issues;
          if (this.job.policy === 'replace_unflagged' && Array.isArray(issues) && !issues.length) {
            await this.deps.rescue.apply(row.file, row.candidateId!); row.outcome = 'applied'; this.followWithCleanup(row);
          } else { row.outcome = 'review'; row.note = issues?.length ? `${issues.length} review signals; current version kept.` : 'Candidate ready; current version kept.'; }
        } catch (error) { row.outcome = 'failed'; row.note = errorText(error); }
        this.persist(); await yieldLoop();
      }
    } finally {
      this.job.state = this.persistenceError ? 'interrupted' : this.job.state === 'stopping' || this.job.rows.some(row => !row.outcome) ? 'stopped' : 'completed';
      this.job.current = ''; this.job.finishedAt = new Date().toISOString();
      if (!this.persistenceError) this.persist();
      this.deps.emit();
    }
  }
}

let service: TranscriptionBatchService | undefined;
export function initTranscriptionBatch(file: string, deps: Partial<Dependencies> = {}) { service = new TranscriptionBatchService(file, deps); return service; }
export function getTranscriptionBatch() {
  if (!service) service = new TranscriptionBatchService(path.join(path.dirname(config.journal.index), '.dictawhisper', 'transcription-batch.json'));
  return service;
}
