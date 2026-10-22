import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';
import { enhanceAudio, enhancementPresets, findOriginalAudio, type EnhancementPreset, type EnhancementReport } from './audioEnhancementLib.ts';
import { transcribeWithQuality, annotateBarkCandidate, barkHasUsableTiming } from './transcriptionQualityLib.ts';
import { isTranscriptionModel } from './asrModels.ts';
import { allowedRoots, resolveAllowedPath } from './pathAllowLib.ts';
import { assertEntryWritable, withEntryOperation } from './entryOperationLib.ts';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { ensureEntryId } from './entryIdentityLib.ts';
import { activity, isWorkingStage } from './activityLib.ts';
import { emitTranscription, emitNotesIndex } from './transcriptionLib.ts';
import { writeEntryJson } from './entryBundleLib.ts';
import { BARK_MODEL, runBark, barkAvailability } from './barkLib.ts';

type Phase = 'preparing' | 'preview' | 'transcribing' | 'ready' | 'failed' | 'applied' | 'reverted' | 'discarded';
type Model = string;
export type RescueJob = {
  version: 1; id: string; entryId: string; file: string; phase: Phase;
  preset: EnhancementPreset; model: Model; vadFilter: boolean; createdAt: string;
  sourceExt: string; sourceOriginal: boolean; baseline: string;
  report?: EnhancementReport; error?: string; failedStage?: 'preparing' | 'transcribing';
  acceptedFingerprint?: string;
  acceptedBaseline?: string;
  firstImport?: boolean;
  sourceSize?: number; sourceMtimeMs?: number; sourceHash?: string;
};
type Dependencies = {
  enhance: typeof enhanceAudio;
  bark: typeof runBark;
  barkAvailability: typeof barkAvailability;
  transcribe: (audio: string, output: string, model: Model, vad: boolean, report?: EnhancementReport) => Promise<void>;
};
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_EXT = /^\.(webm|mp3|m4a|wav|ogg)$/i;
const transcriptKeys = ['text', 'segments', 'language', 'elapsed', 'whisper', 'asr', 'asrExperiment', 'cleanedTranscription', 'cleanup', 'cleanupHistory', 'thinking', 'meta', 'promptVersion', 'playbackCues', 'playbackCuesSource', 'cleanupError', 'cleanupAttempts', 'cleanupSkipped', 'audioError', 'audioEnhancement', 'transcriptionQuality'] as const;
const jsonRead = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fingerprint = (json: TranscriptionDocument) => createHash('sha256').update(JSON.stringify([json.text, json.segments, json.cleanedTranscription, json.cleanup, json.whisper, json.audioEnhancement])).digest('hex');
const samePath = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
async function fileHash(file: string) {
  const hash = createHash('sha256');
  for await (const data of fs.createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}

function checked(file: string) {
  const result = resolveAllowedPath(file);
  if (!result.ok) throw new Error(result.error);
  return result;
}
function entry(file: string, writable = false) {
  const result = checked(file);
  if (!/\.json$/i.test(result.path) || isSkippedWatchPath(result.path)) throw new Error('Choose an entry transcript.');
  const json = jsonRead(result.path) as TranscriptionDocument;
  if (!json || typeof json !== 'object' || Array.isArray(json) || !(typeof json.text === 'string' || Array.isArray(json.segments) || json.audioError)) throw new Error('This file is not an entry transcript.');
  if (writable) {
    assertEntryWritable(result.path);
    if (isWorkingStage(activity.find(result.path)?.stage || 'ready')) throw new Error('This entry is processing. Try again when it finishes.');
  }
  return { ...result, json };
}
function owned(root: string, id?: string, name?: string) {
  if (id && !ID.test(id)) throw new Error('Invalid audio improvement ID.');
  const expected = path.join(root, '.dictawhisper', 'audio-improvements', ...(id ? [id] : []), ...(name ? [name] : []));
  const actual = checked(expected).path;
  if (!samePath(actual, expected)) throw new Error('Audio improvement storage redirects elsewhere.');
  return actual;
}
function save(root: string, job: RescueJob) {
  const directory = owned(root, job.id); fs.mkdirSync(directory, { recursive: true });
  writeEntryJson(owned(root, job.id, 'job.json'), JSON.stringify(job, null, 2));
}
function assertCandidate(json: TranscriptionDocument) {
  if (!json || typeof json.text !== 'string' || !json.text.trim() || !Array.isArray(json.segments) || !json.segments.length || json.segments.some(row => !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end < row.start || typeof row.text !== 'string')) throw new Error('No usable timed transcript was produced. Your current transcript is unchanged.');
}
function changed(file: string) { emitTranscription(null, file); emitNotesIndex(); }
function reviewCandidates(rows: { job: RescueJob }[], activeId?: string) {
  const active = rows.find(row => row.job.id === activeId)?.job;
  return rows.filter(({ job }) => job.phase === 'ready' && job.id !== activeId && (!active || job.createdAt >= active.createdAt))
    .map(({ job }) => ({ id: job.id, model: job.model, createdAt: job.createdAt }));
}

/** Jobs persist under watch roots; only explicit acceptance changes transcript/audio. */
export class AudioRescueService {
  private running = new Map<string, Promise<void>>();
  private importing = new Set<string>();
  // Index identities once per process; reread only this entry's manifests, not the entire library per poll.
  private history = new Map<string, Map<string, Set<string>>>();
  private historyStamp = new Map<string, number>();
  private deps: Dependencies;
  constructor(deps: Partial<Dependencies> = {}) {
    this.deps = { enhance: enhanceAudio, transcribe: transcribeWithQuality, bark: runBark, barkAvailability, ...deps };
  }
  private register(root: string, job: RescueJob) {
    save(root, job);
    const index = this.history.get(root);
    if (index) { const ids = index.get(job.entryId) || new Set<string>(); ids.add(job.id); index.set(job.entryId, ids); }
    this.historyStamp.set(root, fs.statSync(owned(root)).mtimeMs);
  }
  private jobs(json: TranscriptionDocument) {
    const rows: { root: string; job: RescueJob }[] = [];
    if (!json.entryId) return rows;
    for (const inputRoot of [...new Set(allowedRoots())]) {
      const root = checked(inputRoot).path, base = owned(root);
      if (!fs.existsSync(base)) continue;
      let index = this.history.get(root);
      if (!index || this.historyStamp.get(root) !== fs.statSync(base).mtimeMs) {
        index = new Map();
        for (const id of fs.readdirSync(base)) {
          if (!ID.test(id)) continue;
          const file = owned(root, id, 'job.json');
          if (!fs.existsSync(file)) continue;
          const job = jsonRead(file) as RescueJob;
          if (!job.entryId) continue;
          const ids = index.get(job.entryId) || new Set<string>(); ids.add(id); index.set(job.entryId, ids);
        }
        this.history.set(root, index);
        this.historyStamp.set(root, fs.statSync(base).mtimeMs);
      }
      for (const id of index.get(json.entryId) || []) {
        if (!ID.test(id)) continue;
        const file = owned(root, id, 'job.json');
        if (!fs.existsSync(file)) continue;
        const job = jsonRead(file) as RescueJob;
        if (job.version !== 1 || job.id !== id || !SOURCE_EXT.test(job.sourceExt)) throw new Error('Unreadable audio improvement history. Saved files were kept.');
        if (job.entryId !== json.entryId) continue;
        if (['preparing', 'transcribing'].includes(job.phase) && !this.running.has(id) && !this.importing.has(id)) {
          job.failedStage = job.phase as 'preparing' | 'transcribing'; job.phase = 'failed';
          job.error = 'The server stopped before this attempt finished. Retry when you are ready.'; save(root, job);
        }
        // Reconcile a server stop between the atomic entry write and its receipt.
        if (json.audioEnhancement?.versionId === id && job.phase === 'ready') { job.phase = 'applied'; job.acceptedFingerprint = fingerprint(json); save(root, job); }
        if (job.phase === 'applied' && json.audioEnhancement?.versionId !== id && fingerprint(json) === (job.acceptedBaseline || job.baseline)) { job.phase = 'reverted'; save(root, job); }
        rows.push({ root, job });
      }
    }
    return rows.sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  }
  private locate(file: string, id: string) {
    if (!ID.test(id)) throw new Error('Invalid audio improvement ID.');
    const current = entry(file);
    const saved = this.jobs(current.json).find(row => row.job.id === id);
    if (!saved) throw new Error('This audio improvement does not belong to this entry.');
    return { ...saved, current };
  }
  /** Lightweight discovery for mounted cards. Never read candidate transcripts. */
  summary(file: string) {
    const current = entry(file), rows = this.jobs(current.json);
    const active = rows.find(row => row.job.id === current.json.audioEnhancement?.versionId)?.job;
    const pending = reviewCandidates(rows, current.json.audioEnhancement?.versionId);
    return { pending, active: active ? { id: active.id, model: active.model, createdAt: active.createdAt } : null };
  }
  status(file: string, id?: string) {
    const current = entry(file), rows = this.jobs(current.json);
    const selected = id ? rows.find(row => row.job.id === id) : rows[0];
    if (id && !selected) throw new Error('Audio improvement not found for this entry.');
    const job = selected?.job;
    const candidate: TranscriptionDocument | null = job && ['ready', 'applied'].includes(job.phase) ? jsonRead(owned(selected!.root, job.id, 'candidate.json')) : null;
    return {
      pending: reviewCandidates(rows, current.json.audioEnhancement?.versionId),
      defaultModel: config.transcription.model,
      job: job ? { ...job, comparisonOnly: job.model === BARK_MODEL && (!candidate || !barkHasUsableTiming(candidate)), ...(candidate ? { text: String(candidate.text || ''), experiment: candidate.asr || candidate.asrExperiment, quality: candidate.transcriptionQuality, segments: Array.isArray(candidate.segments) ? candidate.segments.map(({start, end, text}) => ({start, end, text})) : [] } : {}) } : null,
      bark: this.deps.barkAvailability(),
      currentText: current.json.text || '', activeVersionId: current.json.audioEnhancement?.versionId || null,
      currentReadableText: current.json.cleanedTranscription || '',
      reviewToken: job?.phase === 'ready' ? fingerprint(current.json) : null,
      currentChanged: Boolean(job?.phase === 'ready' && fingerprint(current.json) !== job.baseline),
      history: rows.filter(row => ['applied', 'reverted'].includes(row.job.phase)).map(({ job }) => ({ id: job.id, preset: job.preset, model: job.model, createdAt: job.createdAt, phase: job.phase })),
      transcriptionEnabled: config.queues.transcription.active,
      canUndo: Boolean(job && !job.firstImport && current.json.audioEnhancement?.versionId === job.id),
    };
  }
  private launch(root: string, job: RescueJob, file: string, operation: () => Promise<void>) {
    // Start on the next microtask, after registration, for truthful interruption detection.
    const promise = Promise.resolve().then(() => withEntryOperation([file], operation)).catch(error => {
      job.failedStage = job.phase === 'transcribing' ? 'transcribing' : 'preparing';
      job.phase = 'failed'; job.error = error instanceof Error ? error.message : String(error); save(root, job);
    }).finally(() => this.running.delete(job.id));
    this.running.set(job.id, promise);
    void promise.catch(error => console.error('[audio-improvement] Could not persist failure:', error));
  }
  async wait(id: string) { await this.running.get(id); }
  markBatch(file: string, id: string, batchId: string) {
    const { root, job } = this.locate(file, id);
    if (job.phase !== 'ready' || !ID.test(batchId)) throw new Error('A ready candidate and valid batch ID are required.');
    const output = owned(root, id, 'candidate.json'), candidate = jsonRead(output) as TranscriptionDocument;
    if (candidate.transcriptionQuality) { candidate.transcriptionQuality.batchId = batchId; writeEntryJson(output, JSON.stringify(candidate, null, 2)); }
  }
  prepare(file: string, options: { preset?: unknown; model?: unknown; vadFilter?: unknown }) {
    const current = entry(file);
    const existing = this.jobs(current.json).find(row => ['preparing', 'transcribing'].includes(row.job.phase));
    if (existing) return this.status(file, existing.job.id);
    entry(file, true);
    if (!enhancementPresets.includes(options.preset as EnhancementPreset)) throw new Error('Choose a supported audio preset.');
    if (!isTranscriptionModel(options.model)) throw new Error('Choose Bark Pro, Whisper large-v3 or Whisper turbo.');
    if (options.model === BARK_MODEL && !this.deps.barkAvailability().available) throw new Error(this.deps.barkAvailability().reason);
    if (typeof options.vadFilter !== 'boolean') throw new Error('Choose a speech detection setting.');
    if (options.model === BARK_MODEL && options.vadFilter) throw new Error('Bark includes all audio; speech detection must be off.');
    const source = findOriginalAudio(current.path);
    if (!source) throw new Error('Source audio was not found next to this entry.');
    checked(source.file);
    const entryId = ensureEntryId(current.json);
    writeEntryJson(current.path, JSON.stringify(current.json, null, 2));
    const job: RescueJob = { version: 1, id: randomUUID(), entryId, file: current.path, phase: 'preparing', preset: options.preset as EnhancementPreset, model: options.model, vadFilter: options.vadFilter, createdAt: new Date().toISOString(), sourceExt: path.extname(source.file).toLowerCase(), sourceOriginal: source.original, baseline: fingerprint(current.json) };
    this.register(current.root, job);
    this.launch(current.root, job, current.path, async () => {
      const before = fs.statSync(source.file), snapshot = owned(current.root, job.id, 'source' + job.sourceExt);
      await fs.promises.copyFile(checked(source.file).path, snapshot, fs.constants.COPYFILE_EXCL);
      const after = fs.statSync(source.file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source audio changed during preparation. Start a new attempt after syncing finishes.');
      job.sourceSize = before.size; job.sourceMtimeMs = before.mtimeMs; job.sourceHash = await fileHash(snapshot);
      job.report = await this.deps.enhance(snapshot, owned(current.root, job.id, 'enhanced.wav'), job.preset);
      job.phase = 'preview'; save(current.root, job);
    });
    return this.status(file, job.id);
  }
  transcribe(file: string, id: string) {
    const { root, job, current } = this.locate(file, id);
    if (job.phase === 'transcribing' || job.phase === 'ready') return this.status(file, id);
    entry(file, true);
    if (!config.queues.transcription.active) throw new Error('Transcription is disabled in Settings. Enable it before creating a transcript.');
    if (!(job.phase === 'preview' || job.phase === 'failed' && job.failedStage === 'transcribing')) throw new Error('Prepare an audio preview first.');
    if (fingerprint(current.json) !== job.baseline) throw new Error('The transcript changed since this preview. Start a new attempt to compare with the current version.');
    job.phase = 'transcribing'; delete job.error; save(root, job);
    this.launch(root, job, current.path, async () => {
      const output = owned(root, id, 'candidate.json');
      if (fs.existsSync(output)) fs.unlinkSync(output);
      if (job.model === BARK_MODEL) await this.deps.bark(owned(root, id, 'enhanced.wav'), output);
      else await this.deps.transcribe(owned(root, id, 'enhanced.wav'), output, job.model, job.vadFilter, job.report);
      const candidate = jsonRead(output) as TranscriptionDocument;
      if (job.model === BARK_MODEL) annotateBarkCandidate(candidate, job.report);
      if (candidate.transcriptionQuality) {
        candidate.transcriptionQuality.source = { size: job.sourceSize!, mtimeMs: job.sourceMtimeMs!, sha256: job.sourceHash };
        writeEntryJson(output, JSON.stringify(candidate, null, 2));
      }
      if (job.model === BARK_MODEL) {
        if (candidate.segments?.length) assertCandidate(candidate);
      } else assertCandidate(candidate);
      job.phase = 'ready'; save(root, job);
    });
    return this.status(file, id);
  }
  audio(file: string, id: string, variant: string) {
    const { root, job } = this.locate(file, id);
    if (!['source', 'enhanced'].includes(variant)) throw new Error('Choose original or enhanced audio.');
    if (job.phase === 'discarded') throw new Error('This preview was discarded.');
    const audio = owned(root, id, variant === 'source' ? 'source' + job.sourceExt : 'enhanced.wav');
    if (!fs.existsSync(audio)) throw new Error('Audio preview is not ready.');
    return checked(audio);
  }
  async apply(file: string, id: string, reviewToken?: unknown) {
    const { root, job, current } = this.locate(file, id);
    if (current.json.audioEnhancement?.versionId === id) return this.status(file, id);
    entry(file, true);
    if (job.phase !== 'ready') throw new Error('A completed candidate transcript is required.');
    if (reviewToken !== undefined && (typeof reviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(reviewToken))) throw new Error('Refresh the comparison before accepting this version.');
    // A reviewed current version may supersede the original baseline. Bind the
    // explicit choice to those exact bytes and still reject changes during review.
    const expected = reviewToken ?? job.baseline;
    return withEntryOperation([current.path], async () => {
      let fresh = jsonRead(current.path) as TranscriptionDocument;
      if (fingerprint(fresh) !== expected) throw new Error('The current transcript changed. Review the updated comparison before accepting; your current version was kept.');
      const candidate = jsonRead(owned(root, id, 'candidate.json')) as TranscriptionDocument;
      if (job.model === BARK_MODEL) {
        if (!barkHasUsableTiming(candidate)) throw new Error('Bark returned no usable passage timing. Keep this result for comparison, or retry with Whisper in Settings.');
        annotateBarkCandidate(candidate, job.report);
        candidate.transcriptionQuality!.source = {size: job.sourceSize!, mtimeMs: job.sourceMtimeMs!, sha256: job.sourceHash};
      }
      assertCandidate(candidate);
      // The immutable sibling is installed first. One atomic JSON swap then selects
      // both its audio and transcript. A crash cannot pair new text with old audio.
      const destination = checked(current.path.slice(0, -5) + `_enhanced-${id}.wav`).path;
      const source = owned(root, id, 'enhanced.wav');
      if (!fs.existsSync(destination)) await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      if (await fileHash(destination) !== await fileHash(source)) throw new Error('Enhanced audio destination changed. Saved versions were kept.');
      fresh = jsonRead(current.path) as TranscriptionDocument;
      if (fingerprint(fresh) !== expected) throw new Error('The current transcript changed while audio was being saved. Review the updated comparison before accepting; your current version was kept.');
      writeEntryJson(owned(root, id, 'previous.json'), JSON.stringify(fresh, null, 2));
      job.acceptedBaseline = fingerprint(fresh); save(root, job);
      const next = { ...fresh };
      for (const key of transcriptKeys) delete next[key];
      for (const key of ['text', 'segments', 'language', 'elapsed', 'whisper', 'asr', 'transcriptionQuality'] as const) if (candidate[key] !== undefined) (next as Record<string, unknown>)[key] = candidate[key];
      next.audioEnhancement = { versionId: id, preset: job.preset, model: job.model, appliedAt: new Date().toISOString() };
      // Existing decisions survive; old timestamps may refer to trimmed audio.
      next.mayDos = fresh.mayDos?.map(row => ({ ...row, start: null, end: null }));
      next.cleanupSkipped = true; // Review raw speech first; readable cleanup is an explicit next action.
      writeEntryJson(current.path, JSON.stringify(next, null, 2));
      job.phase = 'applied'; job.acceptedFingerprint = fingerprint(next); save(root, job); changed(current.path);
      return this.status(file, id);
    });
  }
  /** Normal capture uses the same preparation and diagnostics, publishing only after success. */
  async importAudio(audio: string, file: string, model: string = config.transcription.model, preprocess = true) {
    if (!isTranscriptionModel(model)) throw new Error('Choose a supported transcription model in Settings.');
    if (model === BARK_MODEL && !this.deps.barkAvailability().available) throw new Error(this.deps.barkAvailability().reason);
    const current = checked(file);
    const source = findOriginalAudio(file) || { file: checked(audio).path, original: false };
    checked(source.file);
    return withEntryOperation([current.path, source.file], async () => {
      const initial = fs.existsSync(file) ? jsonRead(file) as TranscriptionDocument : {};
      const baseline = fingerprint(initial), identity = { ...initial };
      const job: RescueJob = { version: 1, id: randomUUID(), entryId: ensureEntryId(identity), file: current.path, phase: 'preparing', preset: preprocess ? 'auto' : 'original', model, vadFilter: false, createdAt: new Date().toISOString(), sourceExt: path.extname(source.file).toLowerCase(), sourceOriginal: source.original, baseline, firstImport: !fs.existsSync(file) };
      this.register(current.root, job);
      this.importing.add(job.id);
      const snapshot = owned(current.root, job.id, 'source' + job.sourceExt), prepared = owned(current.root, job.id, 'enhanced.wav'), output = owned(current.root, job.id, 'candidate.json');
      try {
        const before = fs.statSync(source.file);
        await fs.promises.copyFile(checked(source.file).path, snapshot, fs.constants.COPYFILE_EXCL);
        const after = fs.statSync(source.file);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Recording changed during preparation. Retry after syncing finishes.');
        job.sourceSize = before.size; job.sourceMtimeMs = before.mtimeMs; job.sourceHash = await fileHash(snapshot);
        job.report = await this.deps.enhance(snapshot, prepared, job.preset);
        job.phase = 'transcribing'; save(current.root, job);
        if (model === BARK_MODEL) await this.deps.bark(prepared, output);
        else await this.deps.transcribe(prepared, output, model, false, job.report);
        const candidate = jsonRead(output) as TranscriptionDocument;
        if (model === BARK_MODEL) {
          annotateBarkCandidate(candidate, job.report);
          writeEntryJson(output, JSON.stringify(candidate, null, 2));
          if (!barkHasUsableTiming(candidate)) throw new Error('Bark returned no usable passage timing. Candidate saved; choose Whisper in Settings and retry. Your current transcript was kept.');
        }
        // An empty first import is retained for review; an empty retry must not erase existing words.
        if (initial.text?.trim()) assertCandidate(candidate);
        const fresh = fs.existsSync(file) ? jsonRead(file) as TranscriptionDocument : {};
        if (fingerprint(fresh) !== baseline) throw new Error('Transcript changed during processing. Candidate saved; current version kept.');
        const next: TranscriptionDocument = { ...fresh, entryId: identity.entryId };
        for (const key of transcriptKeys) delete next[key];
        for (const key of ['text', 'segments', 'language', 'elapsed', 'whisper', 'asr', 'transcriptionQuality'] as const) if (candidate[key] !== undefined) (next as Record<string, unknown>)[key] = candidate[key];
        if (next.transcriptionQuality) next.transcriptionQuality.source = { size: before.size, mtimeMs: before.mtimeMs, sha256: job.sourceHash };
        writeEntryJson(output, JSON.stringify({ ...candidate, transcriptionQuality: next.transcriptionQuality }, null, 2));
        const destination = checked(file.slice(0, -5) + `_enhanced-${job.id}.wav`).path;
        await fs.promises.copyFile(prepared, destination, fs.constants.COPYFILE_EXCL);
        if (await fileHash(destination) !== await fileHash(prepared)) throw new Error('Prepared audio copy could not be verified.');
        if (fingerprint(fs.existsSync(file) ? jsonRead(file) : {}) !== baseline) throw new Error('Transcript changed before publication. Current version kept.');
        writeEntryJson(owned(current.root, job.id, 'previous.json'), JSON.stringify(fresh, null, 2));
        next.audioEnhancement = { versionId: job.id, preset: job.report.selectedPreset || job.preset, model, appliedAt: new Date().toISOString() };
        next.mayDos = fresh.mayDos?.map(row => ({ ...row, start: null, end: null }));
        writeEntryJson(file, JSON.stringify(next, null, 2));
        job.phase = 'applied'; job.acceptedFingerprint = fingerprint(next); save(current.root, job);
        return { transcriptionFile: file, elapsed: next.elapsed };
      } catch (error) {
        job.failedStage = job.phase === 'transcribing' ? 'transcribing' : 'preparing'; job.phase = 'failed'; job.error = String(error); save(current.root, job); throw error;
      } finally { this.importing.delete(job.id); }
    });
  }
  async restore(file: string, id: string) {
    const { root, job, current } = this.locate(file, id);
    if (job.phase === 'reverted') return this.status(file, id);
    if (job.firstImport) throw new Error('This is the first transcript for this recording. There is no previous transcript to restore.');
    entry(file, true);
    if (current.json.audioEnhancement?.versionId !== id) throw new Error('Only the current improved version can be undone.');
    return withEntryOperation([current.path], async () => {
      const fresh = jsonRead(current.path) as TranscriptionDocument;
      if (fingerprint(fresh) !== job.acceptedFingerprint) throw new Error('This transcript has changed since acceptance. Previous versions remain saved; automatic Undo would overwrite newer work.');
      const previous = jsonRead(owned(root, id, 'previous.json')) as TranscriptionDocument;
      const next = { ...fresh };
      for (const key of transcriptKeys) { delete next[key]; if (previous[key] !== undefined) (next as Record<string, unknown>)[key] = previous[key]; }
      // Restore old anchors only for the same unchanged source quote; retain status/title edits.
      next.mayDos = fresh.mayDos?.map(row => {
        const old = previous.mayDos?.find(saved => saved.id === row.id && saved.sourceQuote === row.sourceQuote);
        return { ...row, start: old?.start ?? null, end: old?.end ?? null };
      });
      writeEntryJson(current.path, JSON.stringify(next, null, 2));
      job.phase = 'reverted'; save(root, job); changed(current.path); return this.status(file, id);
    });
  }
  discard(file: string, id: string) {
    const { root, job } = this.locate(file, id);
    if (['preparing', 'transcribing', 'applied'].includes(job.phase)) throw new Error('Wait for this attempt to finish, or undo its accepted version first.');
    job.phase = 'discarded'; save(root, job);
    // Remove only known attempt artifacts, never recursively delete a supplied path.
    for (const name of ['source' + job.sourceExt, 'enhanced.wav', 'candidate.json']) {
      const file = owned(root, id, name); if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    return this.status(file, id);
  }
}
export const audioRescue = new AudioRescueService();
