import path from 'path';
import fs from 'fs';
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
import { dropSidecar, indexSidecar, notesIndexPayload } from './journalService.ts';

export const transcriptions: Record<string, any> = {};

let liveIo: SocketIOServer | null = null;

export function setTranscriptionIo(io: SocketIOServer | null) {
  liveIo = io;
}

export function emitNotesIndex(target: Socket | SocketIOServer | null = null) {
  const dest = target ?? liveIo;
  dest?.emit('notes-index', notesIndexPayload(listNoteSummaries));
}

export function forgetTranscription(jsonFile: string) {
  delete transcriptions[jsonFile];
  dropSidecar(jsonFile);
}

export function relocateTranscription(oldJson: string, newJson: string) {
  if (oldJson === newJson) return;
  if (Object.hasOwn(transcriptions, oldJson)) {
    transcriptions[newJson] = transcriptions[oldJson];
    delete transcriptions[oldJson];
  }
  dropSidecar(oldJson);
  if (fs.existsSync(newJson)) indexSidecar(newJson);
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
      tags: Array.isArray(json?.tags) ? json.tags : [],
      elapsed: json?.elapsed ?? null,
      cleanupError: json?.cleanupError ?? null,
      cleanupAttempts: json?.cleanupAttempts ?? 0,
      cleanupSkipped: Boolean(json?.cleanupSkipped),
      preview,
      hasCleaned: Boolean(cleaned),
      audioError: json?.audioError ? String(json.audioError) : null,
      _partial: true,
    },
  };
}

export function listNoteSummaries() {
  return Object.entries(transcriptions).map(([jsonFile, json]) => summarizeTranscription(jsonFile, json));
}

export function readTranscription(jsonFile: string) {
  if (!fs.existsSync(jsonFile)) return null;
  const transcriptionJson = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  let dirty = false;
  if (ensurePlaybackCues(transcriptionJson)) dirty = true;
  if (dirty) {
    fs.writeFileSync(jsonFile, JSON.stringify(transcriptionJson, null, 2), { encoding: 'utf-8' });
  }
  transcriptions[jsonFile] = transcriptionJson;
  return { jsonFile, transcriptionJson };
}

export function emitTranscription(target: Socket | SocketIOServer | null = null, jsonFile: string, elapsed: string | null = null) {
  if (!fs.existsSync(jsonFile)) {
    console.error(`[emit-transcription-error] JSON file does not exist (yet): ${jsonFile}`);
    return;
  }
  const transcriptionJson = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
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
  dest?.emit('transcription', { jsonFile, transcriptionJson });
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
    const transcriptionJson = JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8'));
    return {
      isProcessed: Boolean(transcriptionJson.cleanedTranscription || transcriptionJson.audioError),
      transcriptionFile,
      transcriptionExists,
    };
  }
  return { isProcessed: false, transcriptionFile, transcriptionExists };
}

export async function cleanTranscription(
  file: string,
  callback: (err: Error | null, result?: string) => void,
  options: { reclean?: boolean } = {}
) {
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
    if (!transcriptionJson.text) {
      callback(new Error(`No text in ${transcriptionFile}`));
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

export async function process(file: string, options: ProcessOptions = {}) {
  requestWhenSettled(file, () => enqueueTranscription(file, options), {
    force: options.force,
    retry: options.retry,
    settleMs: options.settleMs,
    label: 'voice-transcribe',
  });
}

function readSidecar(transcriptionFile: string): TranscriptionDocument | null {
  try {
    if (!fs.existsSync(transcriptionFile)) return null;
    return JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8')) as TranscriptionDocument;
  } catch {
    return null;
  }
}

function enqueueProcessing(file: string, elapsed?: string) {
  const { transcriptionFile } = checkTranscription(file);
  const sidecar = readSidecar(transcriptionFile);
  if (sidecar?.cleanupSkipped) {
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  if (!ollanetIsConfigured()) {
    if (config.ollanet.required) {
      recordCleanupFailure(transcriptionFile, new Error('ollanet is required but machine/model are not configured'));
    } else {
      console.log(`[process] ollanet not configured; leaving raw transcript ${transcriptionFile}`);
    }
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  if (!q['processing']) {
    emitTranscription(null, transcriptionFile, elapsed ?? null);
    return;
  }
  console.log(`[process] Adding file to processing queue: ${file}`);
  q['processing'].push({ file }, () => {
    emitTranscription(null, transcriptionFile, elapsed ?? null);
  });
  emitTranscription(null, transcriptionFile, elapsed ?? null);
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

  console.log(`[process] Adding file to transcription queue: ${file}`);
  const enqueue = options.front ? q['transcription'].unshift.bind(q['transcription']) : q['transcription'].push.bind(q['transcription']);
  enqueue(
    { file, transcriptionFile, transcriptionFolder: path.dirname(transcriptionFile) },
    (_err: any, result?: any) => {
      if (_err instanceof Error) return;
      if (_err?.err) return;
      const elapsed = result?.elapsed ?? result?.result?.elapsed ?? _err?.result?.elapsed;
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
        isSkippedWatchPath(filePath) ||
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
