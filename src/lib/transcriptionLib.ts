import { activity } from './activityLib.ts';
import { preserveHumanEdits } from './humanEditsLib.ts';
import path from 'path';
import { mayDoExtractionState } from './mayDoLib.ts';
import fs from 'fs';
import { ensureEntryId } from './entryIdentityLib.ts';
import { assertEntryWritable, entryOperationPending } from './entryOperationLib.ts';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { q } from './queueLib.ts';
import { audioFileRegex } from './audioLib.ts';
import { ensurePlaybackCues } from './alignLib.ts';
import { isSkippedWatchPath, requestWhenSettled } from './fileSettleLib.ts';
import { Watcher } from '../classes/Watcher.ts';
import { parseJSON } from './jsonLib.ts';
import { cleanWithOllanet, describeCleanError } from './ollanetLib.ts';
import { buildCleanTranscriptionPrompt, CLEAN_PROMPT_VERSION } from '../prompts/cleanTranscription.ts';
import { collapseSpeechLoops } from './speechCleanupLib.ts';
import { config } from '../config.ts';
import { ollanetIsConfigured } from './ollanetReadyLib.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';
import { applyCleanupProvenance, dictawhisperVersion } from './cleanupProvenanceLib.ts';
import { dropSidecar, indexSidecar, notesIndexReload } from './journalService.ts';
import {getJournalIndex} from './journalIndexLib.ts';
import { isMayDoStatus, mayDoCandidateSchema, mayDoSourceHash, mayDoSummary, mergeMayDos, validMayDos, MAY_DO_VERSION } from './mayDoLib.ts';

export const transcriptions: Record<string, any> = {};

let liveIo: SocketIOServer | null = null;

export function setTranscriptionIo(io: SocketIOServer | null) {
  liveIo = io;
}

export function emitNotesIndex(target: Socket | SocketIOServer | null = null) {
  const dest = target ?? liveIo;
  dest?.emit('notes-index', notesIndexReload());
}

export function forgetTranscription(jsonFile: string) {
  delete transcriptions[jsonFile];
  dropSidecar(jsonFile);
}

export function relocateTranscription(oldJson: string, newJson: string) {
  getJournalIndex()?.relocateSidecar(oldJson,newJson);
  if (oldJson === newJson) return;
  if (Object.hasOwn(transcriptions, oldJson)) {
    transcriptions[newJson] = transcriptions[oldJson];
    delete transcriptions[oldJson];
  }
}

const PREVIEW_LIMIT = 200;

export function summarizeTranscription(jsonFile: string, json: any = transcriptions[jsonFile]) {
  const cleaned = String(json?.cleanedTranscription || '').trim();
  const raw = String(json?.text || '').trim();
  const source = cleaned || raw;
  const compact = source.replace(/\s+/g, ' ').trim();
  const preview = json?.audioError && !compact
    ? '[unreadable audio]'
    : compact.length > PREVIEW_LIMIT
      ? `${compact.slice(0, PREVIEW_LIMIT)}…`
      : compact;
  return {
    jsonFile,
    basename: path.basename(jsonFile),
    transcriptionJson: {
      ...mayDoSummary(json?.mayDos),
      entryId: json?.entryId, recordedDate: json?.recordedDate, recordedAtSource: json?.recordedAtSource,
      displayTitle: json?.displayTitle,
      tags: Array.isArray(json?.tags) ? json.tags : [],
      elapsed: json?.elapsed ?? null,
      cleanupError: json?.cleanupError ?? null,
      cleanupAttempts: json?.cleanupAttempts ?? 0,
      cleanupSkipped: Boolean(json?.cleanupSkipped),
      preview,
      hasCleaned: Boolean(cleaned),
      audioError: json?.audioError ? String(json.audioError) : null,
      starred: Boolean(json?.starred),
      _partial: true,
    },
  };
}

export function listNoteSummaries() {
  return Object.entries(transcriptions).map(([jsonFile, json]) => summarizeTranscription(jsonFile, json));
}

function readSidecar(transcriptionFile: string): TranscriptionDocument | null {
  try {
    if (!fs.existsSync(transcriptionFile)) return null;
    return JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8')) as TranscriptionDocument;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[transcription] unreadable sidecar ${transcriptionFile}: ${detail}`);
    return null;
  }
}

function sidecarIsProcessed(json: TranscriptionDocument | null): boolean {
  if (!json) return false;
  if (json.cleanedTranscription || json.audioError || json.cleanupSkipped) return true;
  return typeof json.text === 'string' && !json.text.trim() && Array.isArray(json.segments);
}

export function readTranscription(jsonFile: string) {
  const transcriptionJson = readSidecar(jsonFile);
  if (!transcriptionJson) return null;
  let dirty = false;
  if (ensurePlaybackCues(transcriptionJson)) dirty = true;
  if (dirty) {
    fs.writeFileSync(jsonFile, JSON.stringify(transcriptionJson, null, 2), { encoding: 'utf-8' });
  }
  transcriptions[jsonFile] = transcriptionJson;
  return { jsonFile, transcriptionJson: { ...transcriptionJson, mayDoState: mayDoExtractionState(transcriptionJson) } };
}

export function emitTranscription(target: Socket | SocketIOServer | null = null, jsonFile: string, elapsed: string | null = null) {
  if (!fs.existsSync(jsonFile)) {
    console.error(`[emit-transcription-error] JSON file does not exist (yet): ${jsonFile}`);
    return;
  }
  const transcriptionJson = readSidecar(jsonFile);
  if (!transcriptionJson) return;
  let dirty = false;
  if (elapsed && !Object.hasOwn(transcriptionJson, 'elapsed')) {
    transcriptionJson.elapsed = elapsed;
    dirty = true;
  }
  if (ensurePlaybackCues(transcriptionJson)) dirty = true;
  if (dirty) {
    fs.writeFileSync(jsonFile, JSON.stringify(transcriptionJson, null, 2), { encoding: 'utf-8' });
  }
  transcriptions[jsonFile] = transcriptionJson;
  indexSidecar(jsonFile);
  const dest = target ?? liveIo;
  dest?.emit('transcription', summarizeTranscription(jsonFile, transcriptionJson));
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw || '').trim().replace(/\s+/g, '-');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 40);
}

export function patchTranscription(
  jsonFile: string,
  patch: { displayTitle?: string; tags?: unknown; expectedTags?: unknown; starred?: boolean; mayDo?: { id: string; status: unknown; expectedStatus?: unknown } },
) {
  assertEntryWritable(jsonFile);
  if (!fs.existsSync(jsonFile)) {
    throw new Error('note not found');
  }
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf-8')) as TranscriptionDocument;
  ensureEntryId(json);
  if (patch.tags !== undefined) {
    if(patch.expectedTags !== undefined && JSON.stringify(normalizeTags(json.tags)) !== JSON.stringify(normalizeTags(patch.expectedTags))) throw new Error('Tags changed elsewhere. Refresh before Undo.');
    json.tags = normalizeTags(patch.tags);
    json.tagsEditedAt = new Date().toISOString();
  }
  if (patch.displayTitle !== undefined) {
    if (typeof patch.displayTitle !== 'string' || patch.displayTitle.trim().length > 160) throw new Error('invalid display title');
    json.displayTitle = patch.displayTitle.trim();
  }
  if (typeof patch.starred === 'boolean') {
    json.starred = patch.starred;
  }
  if (patch.mayDo) {
    if (!isMayDoStatus(patch.mayDo.status)) throw new Error('invalid MayDo status');
    const row = validMayDos(json.mayDos).find(row => row.id === patch.mayDo?.id);
    if (!row) throw new Error('MayDo not found');
    if (patch.mayDo.expectedStatus !== undefined && row.status !== patch.mayDo.expectedStatus) throw new Error('This action changed elsewhere. Refresh the entry before trying again.');
    row.status = patch.mayDo.status;
    row.updatedAt = new Date().toISOString();
  }
  fs.writeFileSync(jsonFile, JSON.stringify(json, null, 2), { encoding: 'utf-8' });
  transcriptions[jsonFile] = json;
  indexSidecar(jsonFile);
  liveIo?.emit('transcription', { jsonFile, transcriptionJson: json });
  return { jsonFile, transcriptionJson: { ...json, mayDoState: mayDoExtractionState(json) } };
}

export function getTranscriptionFilename(file: string): string {
  const parsed = path.parse(file);
  return path.join(parsed.dir, `${parsed.name}.json`);
}

export function checkTranscription(file: string): {
  isProcessed: boolean;
  transcriptionFile: string;
  transcriptionExists: boolean;
} {
  const transcriptionFile = getTranscriptionFilename(file);
  const transcriptionExists = fs.existsSync(transcriptionFile);
  if (transcriptionExists) {
    const transcriptionJson = readSidecar(transcriptionFile);
    return {
      isProcessed: sidecarIsProcessed(transcriptionJson),
      transcriptionFile,
      transcriptionExists,
    };
  }
  return { isProcessed: false, transcriptionFile, transcriptionExists };
}

const cleaning = new Map<string, Promise<{ err: Error | null; result?: string }>>();

export async function cleanTranscription(
  file: string,
  callback: (err: Error | null, result?: string) => void,
  options: { reclean?: boolean } = {}
) {
  const key = path.resolve(getTranscriptionFilename(file));
  if (cleaning.has(key)) { const result = await cleaning.get(key)!; callback(result.err, result.result); return; }
  let resolve!: (result: { err: Error | null; result?: string }) => void;
  cleaning.set(key, new Promise(done => { resolve = done; }));
  activity.update(file, 'cleaning', { hasTranscript: true });
  await cleanTranscriptionOnce(file, (err, result) => {
    cleaning.delete(key); resolve({ err, result });
    const json = readSidecar(key);
    activity.update(file, err ? 'failed_cleanup' : json?.mayDoError ? 'failed_maydos' : json?.cleanedTranscription ? 'ready' : 'raw_only', { hasTranscript: Boolean(json), error: err?.message || json?.mayDoError });
    callback(err, result);
  }, options);
}

async function cleanTranscriptionOnce(file: string, callback: (err: Error | null, result?: string) => void, options: { reclean?: boolean } = {}) {
  const { isProcessed, transcriptionFile, transcriptionExists } = checkTranscription(file);
  if (isProcessed && !options.reclean) {
    try {
      const existing = JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8'));
      if (ensurePlaybackCues(existing)) {
        fs.writeFileSync(transcriptionFile, JSON.stringify(existing, null, 2), { encoding: 'utf-8' });
      }
    } catch {
      // already cleaned; cues are optional
    }
    console.log(`[clean-transcription] Transcription already cleaned: ${transcriptionFile}`);
    callback(null);
    return;
  }
  if (!transcriptionExists) {
    callback(new Error(`No transcription JSON for ${file}`));
    return;
  }

  try {
    const transcriptionJson = JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8'));
    const initialHumanEdits = structuredClone(transcriptionJson);
    if (!String(transcriptionJson.text || '').trim()) {
      console.log(`[clean-transcription] no speech to clean: ${transcriptionFile}`);
      callback(null);
      return;
    }

    const { preferredTagsForCleanup } = await import('./tagConsolidateLib.ts');
    const prompt = buildCleanTranscriptionPrompt(
      collapseSpeechLoops(transcriptionJson.text),
      preferredTagsForCleanup()
    );
    console.log(
      `[clean-transcription] Cleaning via ollanet ${config.ollanet.machine} / ${config.ollanet.cleanModel}: ${transcriptionFile}`
    );

    const responseJSONSchema = zodToJsonSchema(
      z.object({
        cleanedTranscription: z.string().min(10),
        tags: z.array(z.string().min(1)),
        mayDos: z.array(mayDoCandidateSchema),
      })
    );

    const { completion, meta, thinking } = await cleanWithOllanet(prompt, responseJSONSchema as Record<string, unknown>);
    const jsonCompletion = await parseJSON(completion);
    if (!jsonCompletion || !jsonCompletion.cleanedTranscription) {
      console.error(`[clean-transcription-error] No cleaned transcription returned for file: ${transcriptionFile}`);
      callback(new Error(`No cleaned transcription returned for ${transcriptionFile}`));
      return;
    }

    applyCleanupProvenance(transcriptionJson, {
      text: jsonCompletion.cleanedTranscription,
      model: String(meta?.model || config.ollanet.cleanModel || '').trim(),
      host: String(meta?.machine || config.ollanet.machine || '').trim(),
      promptVersion: CLEAN_PROMPT_VERSION,
      dictawhisperVersion: dictawhisperVersion(),
    });
    transcriptionJson.tags = jsonCompletion.tags || [];
    if (thinking) transcriptionJson.thinking = thinking;
    if (meta) transcriptionJson.meta = meta;
    delete transcriptionJson.cleanupError;
    delete transcriptionJson.cleanupSkipped;
    ensurePlaybackCues(transcriptionJson);
    // Reload human decisions made while the model was working.
    const fresh = readSidecar(transcriptionFile);
    if (!fresh) throw new Error('Entry disappeared during cleanup.');
    if (fresh.text !== initialHumanEdits.text) throw new Error('Original transcript changed during cleanup; retry.');
    preserveHumanEdits(transcriptionJson, initialHumanEdits, fresh);
    if (Array.isArray(jsonCompletion.mayDos)) {
      transcriptionJson.mayDos = mergeMayDos(fresh?.mayDos, jsonCompletion.mayDos, transcriptionJson.text, transcriptionJson.playbackCues);
      transcriptionJson.mayDoExtraction = { version: MAY_DO_VERSION, sourceHash: mayDoSourceHash(transcriptionJson.cleanedTranscription.trim()), createdAt: new Date().toISOString(), model: String(meta?.model || config.ollanet.cleanModel), host: String(meta?.machine || config.ollanet.machine) };
      delete transcriptionJson.mayDoError;
    } else {
      transcriptionJson.mayDos = fresh?.mayDos || [];
      transcriptionJson.mayDoExtraction = fresh?.mayDoExtraction;
      transcriptionJson.mayDoError = 'The model did not return MayDos. Extract them again from the entry.';
    }
    fs.writeFileSync(transcriptionFile, JSON.stringify(transcriptionJson, null, 2), { encoding: 'utf-8' });
    console.log(`[clean-transcription] Cleaned transcription file: ${transcriptionFile}`);
    callback(null, transcriptionJson.cleanedTranscription);
  } catch (error: any) {
    const detail = describeCleanError(error);
    console.error(`[clean-transcription-error] ${transcriptionFile}: ${detail}`);
    recordCleanupFailure(transcriptionFile, error);
    callback(error);
  }
}

function recordCleanupFailure(transcriptionFile: string, error: unknown) {
  try {
    if (!fs.existsSync(transcriptionFile)) return;
    const json = JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8'));
    json.cleanupError = describeCleanError(error);
    json.cleanupAttempts = (Number(json.cleanupAttempts) || 0) + 1;
    fs.writeFileSync(transcriptionFile, JSON.stringify(json, null, 2), { encoding: 'utf-8' });
  } catch {
    // sidecar write is best-effort
  }
}

export function recordAudioFailure(transcriptionFile: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const json = (readSidecar(transcriptionFile) || {}) as TranscriptionDocument;
  json.audioError = message.slice(0, 500);
  json.cleanupSkipped = true;
  fs.writeFileSync(transcriptionFile, JSON.stringify(json, null, 2), { encoding: 'utf-8' });
  transcriptions[transcriptionFile] = json;
  indexSidecar(transcriptionFile);
}

export type ProcessOptions = {
  force?: boolean;
  retry?: boolean;
  settleMs?: number;
  /** Put this job ahead of the remaining backlog. */
  front?: boolean;
};

const queuedTranscriptions = new Set<string>();
const queuedCleanups = new Set<string>();
export async function process(file: string, options: ProcessOptions = {}) {
  assertEntryWritable(file); assertEntryWritable(getTranscriptionFilename(file));
  const key = path.resolve(getTranscriptionFilename(file));
  if (queuedTranscriptions.has(key) || queuedCleanups.has(key) || cleaning.has(key)) return activity.find(key);
  const current = activity.find(key);
  if (current?.stage === 'interrupted' && !options.retry) return current;
  requestWhenSettled(file, () => enqueueTranscription(file, options), {
    force: options.force,
    retry: options.retry,
    settleMs: options.settleMs,
    label: 'voice-transcribe',
    onWaiting: (status, eligibleAt) => activity.update(file, 'waiting_for_file', { eligibleAt, reason: status.reason }),
  });
  return activity.find(key);
}

function enqueueProcessing(file: string, elapsed?: string, reclean = false) {
  const { transcriptionFile } = checkTranscription(file);
  const sidecar = readSidecar(transcriptionFile);
  if (sidecarIsProcessed(sidecar) && !reclean) {
    activity.update(file, sidecar?.audioError ? 'failed_transcription' : sidecar?.mayDoError ? 'failed_maydos' : sidecar?.cleanedTranscription ? 'ready' : 'raw_only', { hasTranscript: true, error: sidecar?.audioError || sidecar?.mayDoError });
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  if (!String(sidecar?.text || '').trim()) {
    activity.update(file, 'raw_only', { hasTranscript: true, reason: 'No speech to clean.' });
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  if (!ollanetIsConfigured()) {
    if (config.ollanet.required) {
      recordCleanupFailure(transcriptionFile, new Error('ollanet is required but machine/model are not configured'));
    } else {
      console.log(`[process] ollanet not configured; leaving raw transcript ${transcriptionFile}`);
    }
    activity.update(file, config.ollanet.required ? 'failed_cleanup' : 'raw_only', { hasTranscript: true, reason: 'Cleanup is not configured. Original transcript remains available.', error: config.ollanet.required ? 'Configure cleanup host and model.' : undefined });
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  if (!q['processing']) {
    activity.update(file, 'raw_only', { hasTranscript: true, reason: 'Cleanup queue is disabled.' });
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  console.log(`[process] Adding file to processing queue: ${file}`);
  const key = path.resolve(transcriptionFile);
  if (queuedCleanups.has(key) || cleaning.has(key)) return;
  queuedCleanups.add(key);
  activity.update(file, 'queued_cleanup', { hasTranscript: true });
  q['processing'].push({ file, reclean, audioFile: activity.find(file)?.audioFile || file }, () => {
    queuedCleanups.delete(key);
    emitTranscription(null, transcriptionFile, elapsed ?? null);
  });
  emitTranscription(null, transcriptionFile, elapsed ?? null);
}

export function requestCleanup(file: string) {
  assertEntryWritable(file); assertEntryWritable(getTranscriptionFilename(file));
  const key = path.resolve(getTranscriptionFilename(file));
  if (!readSidecar(key)) throw new Error('Transcript not ready yet.');
  if (queuedCleanups.has(key) || cleaning.has(key)) return activity.find(key);
  if (!ollanetIsConfigured() || !q.processing) throw new Error('Cleanup is unavailable. Configure its host/model and enable the cleanup queue; original reading still works.');
  enqueueProcessing(file, undefined, true);
  return activity.find(key);
}

export function skipCleanup(file: string): void {
  const jsonFile = getTranscriptionFilename(file);
  const json = readSidecar(jsonFile) || {};
  json.cleanupSkipped = true;
  json.cleanupError = json.cleanupError || 'skipped';
  fs.writeFileSync(jsonFile, JSON.stringify(json, null, 2), { encoding: 'utf-8' });
  transcriptions[jsonFile] = json;
  emitTranscription(null, jsonFile);
}

function enqueueTranscription(file: string, options: ProcessOptions = {}) {
  const { isProcessed, transcriptionFile, transcriptionExists } = checkTranscription(file);
  if (!fs.existsSync(file)) {
    console.error(`[process-error] File does not exist: ${file}`);
    return;
  }

  if (transcriptionExists && !options.retry) {
    if (!isProcessed) enqueueProcessing(file);
    return;
  }

  const key = path.resolve(transcriptionFile);
  if (queuedTranscriptions.has(key)) return;
  activity.update(file, 'queued_transcription', { audioFile: file, hasTranscript: transcriptionExists, reason: !q['transcription'] ? 'Transcription queue is disabled. Audio is saved; enable the queue before retrying.' : undefined });
  if (!q['transcription']) return;
  queuedTranscriptions.add(key);
  console.log(`[process] Adding file to transcription queue: ${file}`);
  const enqueue = options.front ? q['transcription'].unshift.bind(q['transcription']) : q['transcription'].push.bind(q['transcription']);
  enqueue(
    { file, transcriptionFile, replacement: transcriptionExists, transcriptionFolder: path.dirname(transcriptionFile) },
    (_err: any, result?: any) => {
      queuedTranscriptions.delete(key);
      if (_err instanceof Error || _err?.err) { if (fs.existsSync(transcriptionFile)) emitTranscription(null, transcriptionFile); return; }
      const elapsed = result?.elapsed ?? result?.result?.elapsed ?? _err?.result?.elapsed;
      const originalName = activity.find(transcriptionFile)?.originalName;
      const document = readSidecar(transcriptionFile);
      if (document) { ensureEntryId(document); if(originalName) document.originalFilename=originalName; fs.writeFileSync(transcriptionFile,JSON.stringify(document,null,2),'utf8'); }
      enqueueProcessing(file, elapsed);
    }
  );
}

export function initTranscriptionWatcher(
  watchFolder: null | string = null,
  options: { watchDepth?: number; settleMs?: number } = {}
) {
  if (!watchFolder) {
    console.error('[watcher-error] No watch folder specified');
    return;
  }
  const watchDepth = options.watchDepth ?? 2;
  new Watcher({
    watchFolder,
    watchDepth,
    ignoreCheck: (filePath) => {
      return (
        entryOperationPending(filePath) || isSkippedWatchPath(filePath) ||
        filePath.includes('archive') ||
        filePath.includes('original') ||
        filePath.includes('_clean')
      );
    },
    fileMatchRegex: audioFileRegex,
    addHandler: async (filePath) => {
      const { isProcessed, transcriptionExists } = checkTranscription(filePath);
      if (transcriptionExists && isProcessed) return;
      await process(filePath, { settleMs: options.settleMs });
    },
    changeHandler: (filePath) => {
      const { isProcessed, transcriptionExists } = checkTranscription(filePath);
      if (transcriptionExists && isProcessed) return;
      void process(filePath, { settleMs: options.settleMs });
    },
  });
}

export function loadExistingTranscriptions(roots: string[]) {
  let loaded = 0;
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isSkippedWatchPath(full)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.json')) continue;
      if (isSkippedWatchPath(full) || full.includes('_original') || full.includes('_clean')) continue;
      try {
        const json = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (!json?.text && !json?.cleanedTranscription && !Array.isArray(json?.segments)) continue;
        transcriptions[full] = json;
        loaded += 1;
      } catch {
        // skip unreadable sidecars
      }
    }
  };

  for (const root of roots) walk(root);
  const indexBytes = Buffer.byteLength(JSON.stringify({ notes: listNoteSummaries() }));
  console.log(
    `[load-transcriptions] loaded ${loaded} sidecar notes from disk (~${(indexBytes / 1024 / 1024).toFixed(1)}MB index)`
  );
}

export function initTranscriptionForSourceFolders(sourceFolders: string[] = []) {
  console.log(
    `[watch-source-folders] skipped separate transcribe watch; voice pipeline owns ${sourceFolders.join(', ')}`
  );
}

export function countStatus(roots: string[]) {
  let pendingAudio = 0;
  let rawOnly = 0;
  let done = 0;
  let unreadable = 0;

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isSkippedWatchPath(full)) continue;
        walk(full);
        continue;
      }
      if (!audioFileRegex.test(full)) continue;
      if (full.includes('_original') || full.includes('_clean')) continue;
      const { transcriptionExists, transcriptionFile } = checkTranscription(full);
      if (!transcriptionExists) {
        pendingAudio += 1;
        continue;
      }
      try {
        const json = JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8'));
        if (json.audioError) unreadable += 1;
        else if (json.cleanedTranscription) done += 1;
        else rawOnly += 1;
      } catch {
        rawOnly += 1;
      }
    }
  };

  for (const root of roots) walk(root);
  return { pendingAudio, rawOnly, done, unreadable };
}
