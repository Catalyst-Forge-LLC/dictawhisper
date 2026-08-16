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
import { buildCleanTranscriptionPrompt } from '../prompts/cleanTranscription.ts';
import { config } from '../config.ts';

export const transcriptions: Record<string, any> = {};

let liveIo: SocketIOServer | null = null;

export function setTranscriptionIo(io: SocketIOServer | null) {
  liveIo = io;
}

export function forgetTranscription(jsonFile: string) {
  delete transcriptions[jsonFile];
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
    return { isProcessed: !!transcriptionJson.cleanedTranscription, transcriptionFile, transcriptionExists };
  }
  return { isProcessed: false, transcriptionFile, transcriptionExists };
}

export async function cleanTranscription(file: string, callback: (err: Error | null, result?: string) => void) {
  const { isProcessed, transcriptionFile, transcriptionExists } = checkTranscription(file);
  if (isProcessed) {
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

    transcriptionJson.text = transcriptionJson.text
      .replaceAll(/\b(uh|um|umm|hmm|yeah)[,\.]?\s*/gi, ' ')
      .replaceAll(/(\. ){2,}/gi, ' ')
      .replace(/(\S+)(?:\s+\1){3,}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    const { preferredTagsForCleanup } = await import('./tagConsolidateLib.ts');
    const prompt = buildCleanTranscriptionPrompt(transcriptionJson.text, preferredTagsForCleanup());
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

    transcriptionJson.cleanedTranscription = jsonCompletion.cleanedTranscription;
    transcriptionJson.tags = jsonCompletion.tags || [];
    if (thinking) transcriptionJson.thinking = thinking;
    if (meta) transcriptionJson.meta = meta;
    delete transcriptionJson.cleanupError;
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

export type ProcessOptions = {
  force?: boolean;
  retry?: boolean;
  settleMs?: number;
};

export async function process(file: string, options: ProcessOptions = {}) {
  requestWhenSettled(file, () => enqueueTranscription(file, options), {
    force: options.force,
    retry: options.retry,
    settleMs: options.settleMs,
    label: 'voice-transcribe',
  });
}

function enqueueProcessing(file: string, elapsed?: string) {
  const { transcriptionFile } = checkTranscription(file);
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

function enqueueTranscription(file: string, options: ProcessOptions = {}) {
  const { isProcessed, transcriptionFile, transcriptionExists } = checkTranscription(file);
  if (!fs.existsSync(file)) {
    console.error(`[process-error] File does not exist: ${file}`);
    return;
  }

  if (transcriptionExists && !options.retry) {
    if (!isProcessed) enqueueProcessing(file);
    else emitTranscription(null, transcriptionFile);
    return;
  }

  console.log(`[process] Adding file to transcription queue: ${file}`);
  q['transcription'].push(
    { file, transcriptionFile, transcriptionFolder: path.dirname(transcriptionFile) },
    (_err: any, result?: any) => {
      const elapsed = result?.elapsed ?? result?.result?.elapsed;
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
      await process(filePath, { settleMs: options.settleMs });
    },
    changeHandler: (filePath) => {
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
        emitTranscription(null, full);
        loaded += 1;
      } catch {
        // skip unreadable sidecars
      }
    }
  };

  for (const root of roots) walk(root);
  console.log(`[load-transcriptions] loaded ${loaded} sidecar notes from disk`);
}

export function initTranscriptionForSourceFolders(sourceFolders: string[] = []) {
  const depth = config.watch.recursiveYears ? 2 : 1;
  sourceFolders.forEach((folder) => {
    initTranscriptionWatcher(folder, { watchDepth: depth });
  });
  console.log(`[watch-source-folders] Transcription initialized for source folders: ${sourceFolders.join(', ')}`);
}

export function countStatus(roots: string[]) {
  let pendingAudio = 0;
  let rawOnly = 0;
  let done = 0;

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
      const { transcriptionExists, isProcessed } = checkTranscription(full);
      if (!transcriptionExists) pendingAudio += 1;
      else if (!isProcessed) rawOnly += 1;
      else done += 1;
    }
  };

  for (const root of roots) walk(root);
  return { pendingAudio, rawOnly, done };
}
