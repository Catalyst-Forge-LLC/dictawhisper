import fs from 'node:fs';
import { assertEntryWritable } from './entryOperationLib.ts';
import { activity } from './activityLib.ts';
import path from 'node:path';
import z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from '../config.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';
import { buildMayDoPrompt } from '../prompts/mayDos.ts';
import { cleanWithOllanet, describeCleanError } from './ollanetLib.ts';
import { ollanetIsConfigured } from './ollanetReadyLib.ts';
import { parseJSON } from './jsonLib.ts';
import { ensurePlaybackCues } from './alignLib.ts';
import { mayDoCandidateSchema, mayDoSourceHash, mergeMayDos, MAY_DO_VERSION, mayDoExtractionState } from './mayDoLib.ts';
import { indexSidecar, listInboxNotes } from './journalService.ts';
import { emitNotesIndex, transcriptions } from './transcriptionLib.ts';
import { resolveAllowedPath } from './pathAllowLib.ts';
import { mayDoSource as sourceOf } from './mayDoBackfillLib.ts';
import { MayDoJobStore } from './mayDoJobLib.ts';

type ExtractResult = { mayDos: unknown[]; model?: string; host?: string };
export type MayDoRunner = (source: string) => Promise<ExtractResult>;
const inFlight = new Map<string, Promise<{ jsonFile: string; transcriptionJson: TranscriptionDocument }>>();

async function runModel(source: string): Promise<ExtractResult> {
  if (!ollanetIsConfigured()) throw new Error('Configure the cleanup model before extracting MayDos.');
  const schema = z.object({ mayDos: z.array(mayDoCandidateSchema).max(100) });
  const { completion, meta } = await cleanWithOllanet(buildMayDoPrompt(source), zodToJsonSchema(schema) as Record<string, unknown>);
  const parsed = schema.safeParse(await parseJSON(completion));
  if (!parsed.success) throw new Error('The model returned invalid MayDos. The previous items were kept.');
  return { mayDos: parsed.data.mayDos, model: String(meta?.model || config.ollanet.cleanModel), host: String(meta?.machine || config.ollanet.machine) };
}

/** Extraction changes only MayDo fields; reread after the model returns to preserve concurrent edits. */
export async function extractMayDos(jsonFile: string, runner: MayDoRunner = runModel) {
  const key = path.resolve(jsonFile);
  assertEntryWritable(key);
  const flightKey = process.platform === 'win32' ? key.toLowerCase() : key;
  const pending = inFlight.get(flightKey);
  if (pending) return pending;
  const task = (async () => {
    const initial = JSON.parse(fs.readFileSync(key, 'utf8')) as TranscriptionDocument;
    const source = sourceOf(initial);
    if (!source || initial.audioError) throw new Error('This entry has no readable transcript to extract MayDos from.');
    try {
      activity.update(key, 'extracting_maydos', { hasTranscript: true });
      const result = await runner(source);
      const fresh = JSON.parse(fs.readFileSync(key, 'utf8')) as TranscriptionDocument;
      if (sourceOf(fresh) !== source) throw new Error('The transcript changed during extraction. Please retry.');
      ensurePlaybackCues(fresh);
      fresh.mayDos = mergeMayDos(fresh.mayDos, result.mayDos, source, fresh.playbackCues);
      fresh.mayDoExtraction = { version: MAY_DO_VERSION, sourceHash: mayDoSourceHash(source), createdAt: new Date().toISOString(), model: result.model, host: result.host };
      delete fresh.mayDoError;
      save(key, fresh);
      activity.update(key, fresh.cleanedTranscription ? 'ready' : 'raw_only', { hasTranscript: true });
      return { jsonFile: key, transcriptionJson: { ...fresh, mayDoState: mayDoExtractionState(fresh) } };
    } catch (error) {
      if (fs.existsSync(key)) {
        const fresh = JSON.parse(fs.readFileSync(key, 'utf8')) as TranscriptionDocument;
        fresh.mayDoError = describeCleanError(error);
        save(key, fresh);
        activity.update(key, 'failed_maydos', { hasTranscript: true, error: fresh.mayDoError });
      }
      throw error;
    }
  })();
  inFlight.set(flightKey, task);
  try { return await task; } finally { inFlight.delete(flightKey); }
}

function save(file: string, json: TranscriptionDocument) {
  fs.writeFileSync(file, JSON.stringify(json, null, 2), 'utf8');
  transcriptions[file] = json;
  indexSidecar(file);
  emitNotesIndex();
}

function readBackfillEntry(file: string) {
  const allowed = resolveAllowedPath(file);
  if (!allowed.ok) throw new Error(allowed.error);
  return JSON.parse(fs.readFileSync(allowed.path, 'utf8')) as TranscriptionDocument;
}
let jobs = new MayDoJobStore({ read: readBackfillEntry, extract: file => extractMayDos(file) });
export function initMayDoBackfill(file: string, emit: () => void = () => {}, extractor = (file: string) => extractMayDos(file)) {
  jobs = new MayDoJobStore({ file, read: readBackfillEntry, extract: extractor, emit });
}
export function mayDoCapabilities() {
  return { available: ollanetIsConfigured(), model: config.ollanet.cleanModel || '', disabledReason: ollanetIsConfigured() ? '' : 'Configure the cleanup model to extract MayDos. Saved actions remain available.' };
}
export function getMayDoBackfill() { return { ...jobs.snapshot(), ...mayDoCapabilities() }; }
export function stopMayDoBackfill(id?: string) { jobs.stop(id); return getMayDoBackfill(); }
export function resumeMayDoBackfill(id?: string, failedOnly = false) {
  if (!ollanetIsConfigured()) throw new Error(mayDoCapabilities().disabledReason);
  jobs.resume(id, failedOnly); return getMayDoBackfill();
}
export function startMayDoBackfill(options: { refresh?: boolean; year?: string } = {}) {
  if (!ollanetIsConfigured()) throw new Error(mayDoCapabilities().disabledReason);
  const files = listInboxNotes({ all: true, folder: 'active' }).filter(note => !options.year || note.day.startsWith(options.year + '-')).map(note => note.jsonFile);
  jobs.start(files, options); return getMayDoBackfill();
}
