import path from 'path';
import fs from 'fs';
import { Socket } from 'socket.io';
import z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { q } from './queueLib.ts';
import { audioFileRegex } from './audioLib.ts';
import { isTransientSyncFile, requestWhenSettled } from './fileSettleLib.ts';
import { Watcher } from '../classes/Watcher.ts';
import { parseJSON } from './jsonLib.ts';
import { cleanWithOllanet } from './ollanetLib.ts';
import { buildCleanTranscriptionPrompt } from '../prompts/cleanTranscription.ts';
import { config } from '../config.ts';

export const transcriptions: Record<string, any> = {};

let liveSocket: Socket | null = null;

export function setTranscriptionSocket(socket: Socket | null) {
  liveSocket = socket;
}

function socketOf(ioSocket: null | Socket) {
  return ioSocket ?? liveSocket;
}

export function emitTranscription(ioSocket: null | Socket = null, jsonFile: string, elapsed: string | null = null) {
  if (!fs.existsSync(jsonFile)) {
    console.error(`[emit-transcription-error] JSON file does not exist (yet): ${jsonFile}`);
    return;
  }
  const transcriptionJson = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  if (elapsed && !Object.hasOwn(transcriptionJson, 'elapsed')) {
    transcriptionJson.elapsed = elapsed;
    fs.writeFileSync(jsonFile, JSON.stringify(transcriptionJson, null, 2), { encoding: 'utf-8' });
  }
  transcriptions[jsonFile] = transcriptionJson;
  if (ioSocket) {
    ioSocket.emit('transcription', { jsonFile, transcriptionJson });
  }
}

export function getTranscriptionFilename(file: string): string {
  return file.replace(/\.(mp3|webm|m4a)/i, '.json').replace(/\\/g, '/');
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

    const prompt = buildCleanTranscriptionPrompt(transcriptionJson.text);
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
    fs.writeFileSync(transcriptionFile, JSON.stringify(transcriptionJson, null, 2), { encoding: 'utf-8' });
    console.log(`[clean-transcription] Cleaned transcription file: ${transcriptionFile}`);
    callback(null, transcriptionJson.cleanedTranscription);
  } catch (error: any) {
    console.error(`[clean-transcription-error] Error cleaning transcription file ${transcriptionFile}:`, error);
    callback(error);
  }
}

export async function process(file: string, ioSocket: null | Socket = null, options: { force?: boolean } = {}) {
  requestWhenSettled(file, () => enqueueTranscription(file, socketOf(ioSocket)), {
    force: options.force,
    label: 'voice-transcribe',
  });
}

function enqueueProcessing(file: string, ioSocket: null | Socket, elapsed?: string) {
  const { transcriptionFile } = checkTranscription(file);
  if (!q['processing']) {
    if (ioSocket) emitTranscription(ioSocket, transcriptionFile, elapsed ?? null);
    return;
  }
  console.log(`[process] Adding file to processing queue: ${file}`);
  q['processing'].push({ file }, () => {
    if (ioSocket) emitTranscription(ioSocket, transcriptionFile, elapsed ?? null);
  });
  if (ioSocket) emitTranscription(ioSocket, transcriptionFile, elapsed ?? null);
}

function enqueueTranscription(file: string, ioSocket: null | Socket = null) {
  const { isProcessed, transcriptionFile, transcriptionExists } = checkTranscription(file);
  if (!fs.existsSync(file)) {
    console.error(`[process-error] File does not exist: ${file}`);
    return;
  }

  if (transcriptionExists) {
    if (!isProcessed) enqueueProcessing(file, ioSocket);
    return;
  }

  console.log(`[process] Adding file to transcription queue: ${file}`);
  q['transcription'].push(
    { file, transcriptionFile, transcriptionFolder: path.dirname(transcriptionFile) },
    (_err: any, result?: any) => {
      const elapsed = result?.elapsed ?? result?.result?.elapsed;
      enqueueProcessing(file, ioSocket, elapsed);
    }
  );
}

export function initTranscriptionWatcher(watchFolder: null | string = null, ioSocket: null | Socket = null, watchDepth = 2) {
  if (!watchFolder) {
    console.error('[watcher-error] No watch folder specified');
    return;
  }
  new Watcher({
    watchFolder,
    watchDepth,
    ignoreCheck: (filePath) => {
      return (
        isTransientSyncFile(filePath) ||
        filePath.includes('archive') ||
        filePath.includes('original') ||
        filePath.includes('_clean')
      );
    },
    fileMatchRegex: audioFileRegex,
    addHandler: async (filePath) => {
      await process(filePath, ioSocket);
    },
    changeHandler: (filePath) => {
      void process(filePath, ioSocket);
    },
  });
}

export function initTranscriptionForSourceFolders(sourceFolders: string[] = [], ioSocket: null | Socket = null) {
  const depth = config.watch.recursiveYears ? 2 : 1;
  sourceFolders.forEach((folder) => {
    initTranscriptionWatcher(folder, ioSocket, depth);
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
        if (isTransientSyncFile(full)) continue;
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
