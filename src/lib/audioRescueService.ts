import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';
import { enhanceAudio, enhancementPresets, findOriginalAudio, type EnhancementPreset, type EnhancementReport } from './audioEnhancementLib.ts';
import { whisperTranscribe } from './whisperLib.ts';
import { allowedRoots, resolveAllowedPath } from './pathAllowLib.ts';
import { assertEntryWritable, withEntryOperation } from './entryOperationLib.ts';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { ensureEntryId } from './entryIdentityLib.ts';
import { activity, isWorkingStage } from './activityLib.ts';
import { emitTranscription, emitNotesIndex } from './transcriptionLib.ts';
import { writeEntryJson } from './entryBundleLib.ts';

type Phase = 'preparing' | 'preview' | 'transcribing' | 'ready' | 'failed' | 'applied' | 'reverted' | 'discarded';
type Model = 'large-v3' | 'turbo';
export type RescueJob = {
  version: 1; id: string; entryId: string; file: string; phase: Phase;
  preset: EnhancementPreset; model: Model; vadFilter: boolean; createdAt: string;
  sourceExt: string; sourceOriginal: boolean; baseline: string;
  report?: EnhancementReport; error?: string; failedStage?: 'preparing' | 'transcribing';
  acceptedFingerprint?: string;
};
type Dependencies = {
  enhance: typeof enhanceAudio;
  transcribe: (audio: string, output: string, model: Model, vad: boolean) => Promise<void>;
};
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SOURCE_EXT = /^\.(webm|mp3|m4a|wav|ogg)$/i;
const transcriptKeys = ['text', 'segments', 'language', 'elapsed', 'whisper', 'cleanedTranscription', 'cleanup', 'cleanupHistory', 'thinking', 'meta', 'promptVersion', 'playbackCues', 'playbackCuesSource', 'cleanupError', 'cleanupAttempts', 'cleanupSkipped', 'audioError', 'audioEnhancement'] as const;
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

/** Jobs persist under watch roots; only explicit acceptance changes transcript/audio. */
export class AudioRescueService {
  private running = new Map<string, Promise<void>>();
  private deps: Dependencies;
  constructor(deps: Partial<Dependencies> = {}) {
    this.deps = { enhance: enhanceAudio, transcribe: (audio, output, model, vad) => new Promise((resolve, reject) => {
      void whisperTranscribe(audio, output, payload => payload.err ? reject(payload.err) : resolve(), model, { vadFilter: vad });
    }), ...deps };
  }
  private jobs(json: TranscriptionDocument) {
    const rows: { root: string; job: RescueJob }[] = [];
    if (!json.entryId) return rows;
    for (const inputRoot of [...new Set(allowedRoots())]) {
      const root = checked(inputRoot).path, base = owned(root);
      if (!fs.existsSync(base)) continue;
      for (const id of fs.readdirSync(base)) {
        if (!ID.test(id)) continue;
        const file = owned(root, id, 'job.json');
        if (!fs.existsSync(file)) continue;
        const job = jsonRead(file) as RescueJob;
        if (job.version !== 1 || job.id !== id || !SOURCE_EXT.test(job.sourceExt)) throw new Error('Unreadable audio improvement history. Saved files were kept.');
        if (job.entryId !== json.entryId) continue;
        if (['preparing', 'transcribing'].includes(job.phase) && !this.running.has(id)) {
          job.failedStage = job.phase as 'preparing' | 'transcribing'; job.phase = 'failed';
          job.error = 'The server stopped before this attempt finished. Retry when you are ready.'; save(root, job);
        }
        // Reconcile a server stop between the atomic entry write and its receipt.
        if (json.audioEnhancement?.versionId === id && job.phase === 'ready') { job.phase = 'applied'; job.acceptedFingerprint = fingerprint(json); save(root, job); }
        if (job.phase === 'applied' && json.audioEnhancement?.versionId !== id && fingerprint(json) === job.baseline) { job.phase = 'reverted'; save(root, job); }
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
  status(file: string, id?: string) {
    const current = entry(file), rows = this.jobs(current.json);
    const selected = id ? rows.find(row => row.job.id === id) : rows[0];
    if (id && !selected) throw new Error('Audio improvement not found for this entry.');
    const job = selected?.job;
    return {
      job: job ? { ...job, text: ['ready', 'applied'].includes(job.phase) ? String(jsonRead(owned(selected!.root, job.id, 'candidate.json')).text || '') : undefined } : null,
      currentText: current.json.text || '', activeVersionId: current.json.audioEnhancement?.versionId || null,
      history: rows.filter(row => ['applied', 'reverted'].includes(row.job.phase)).map(({ job }) => ({ id: job.id, preset: job.preset, model: job.model, createdAt: job.createdAt, phase: job.phase })),
      transcriptionEnabled: config.queues.transcription.active,
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
  prepare(file: string, options: { preset?: unknown; model?: unknown; vadFilter?: unknown }) {
    const current = entry(file);
    const existing = this.jobs(current.json).find(row => ['preparing', 'transcribing'].includes(row.job.phase));
    if (existing) return this.status(file, existing.job.id);
    entry(file, true);
    if (!enhancementPresets.includes(options.preset as EnhancementPreset)) throw new Error('Choose a supported audio preset.');
    if (options.model !== 'large-v3' && options.model !== 'turbo') throw new Error('Choose large-v3 or turbo.');
    if (typeof options.vadFilter !== 'boolean') throw new Error('Choose a speech detection setting.');
    const source = findOriginalAudio(current.path);
    if (!source) throw new Error('Source audio was not found next to this entry.');
    checked(source.file);
    const entryId = ensureEntryId(current.json);
    writeEntryJson(current.path, JSON.stringify(current.json, null, 2));
    const job: RescueJob = { version: 1, id: randomUUID(), entryId, file: current.path, phase: 'preparing', preset: options.preset as EnhancementPreset, model: options.model, vadFilter: options.vadFilter, createdAt: new Date().toISOString(), sourceExt: path.extname(source.file).toLowerCase(), sourceOriginal: source.original, baseline: fingerprint(current.json) };
    save(current.root, job);
    this.launch(current.root, job, current.path, async () => {
      const before = fs.statSync(source.file), snapshot = owned(current.root, job.id, 'source' + job.sourceExt);
      await fs.promises.copyFile(checked(source.file).path, snapshot, fs.constants.COPYFILE_EXCL);
      const after = fs.statSync(source.file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source audio changed during preparation. Start a new attempt after syncing finishes.');
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
      await this.deps.transcribe(owned(root, id, 'enhanced.wav'), output, job.model, job.vadFilter);
      assertCandidate(jsonRead(output)); job.phase = 'ready'; save(root, job);
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
  async apply(file: string, id: string) {
    const { root, job, current } = this.locate(file, id);
    if (current.json.audioEnhancement?.versionId === id) return this.status(file, id);
    entry(file, true);
    if (job.phase !== 'ready') throw new Error('A completed candidate transcript is required.');
    return withEntryOperation([current.path], async () => {
      let fresh = jsonRead(current.path) as TranscriptionDocument;
      if (fingerprint(fresh) !== job.baseline) throw new Error('The transcript changed while this candidate was prepared. Start a new attempt; your current version was kept.');
      const candidate = jsonRead(owned(root, id, 'candidate.json')) as TranscriptionDocument; assertCandidate(candidate);
      // The immutable sibling is installed first. One atomic JSON swap then selects
      // both its audio and transcript. A crash cannot pair new text with old audio.
      const destination = checked(current.path.slice(0, -5) + `_enhanced-${id}.wav`).path;
      const source = owned(root, id, 'enhanced.wav');
      if (!fs.existsSync(destination)) await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      if (await fileHash(destination) !== await fileHash(source)) throw new Error('Enhanced audio destination changed. Saved versions were kept.');
      fresh = jsonRead(current.path) as TranscriptionDocument;
      if (fingerprint(fresh) !== job.baseline) throw new Error('The transcript changed while audio was being saved. Your current version was kept.');
      writeEntryJson(owned(root, id, 'previous.json'), JSON.stringify(fresh, null, 2));
      const next = { ...fresh };
      for (const key of transcriptKeys) delete next[key];
      for (const key of ['text', 'segments', 'language', 'elapsed', 'whisper'] as const) if (candidate[key] !== undefined) (next as Record<string, unknown>)[key] = candidate[key];
      next.audioEnhancement = { versionId: id, preset: job.preset, model: job.model, appliedAt: new Date().toISOString() };
      // Existing decisions survive; old timestamps may refer to trimmed audio.
      next.mayDos = fresh.mayDos?.map(row => ({ ...row, start: null, end: null }));
      next.cleanupSkipped = true; // Review raw speech first; readable cleanup is an explicit next action.
      writeEntryJson(current.path, JSON.stringify(next, null, 2));
      job.phase = 'applied'; job.acceptedFingerprint = fingerprint(next); save(root, job); changed(current.path);
      return this.status(file, id);
    });
  }
  async restore(file: string, id: string) {
    const { root, job, current } = this.locate(file, id);
    if (job.phase === 'reverted') return this.status(file, id);
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
