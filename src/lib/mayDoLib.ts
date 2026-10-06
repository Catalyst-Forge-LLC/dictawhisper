import { mayDoCounts, MAY_DO_STATUSES } from '../shared/mayDoState.ts';
import { createHash } from 'node:crypto';
import z from 'zod';
import type { MayDo, MayDoStatus, PlaybackCue, TranscriptionDocument } from '../types/transcription.ts';

export const MAY_DO_VERSION = 1;
export const mayDoCandidateSchema = z.object({ title: z.string().min(1), verb: z.string().min(1), sourceQuote: z.string().min(8) });
export { MAY_DO_STATUSES } from '../shared/mayDoState.ts';
export type MayDoFilter = 'any' | MayDoStatus | MayDoStatus[];
export function isMayDoStatus(value: unknown): value is MayDoStatus {
  return MAY_DO_STATUSES.includes(value as MayDoStatus);
}
export function parseMayDoFilter(value: unknown): MayDoFilter | undefined {
  return value === 'any' || isMayDoStatus(value) ? value : undefined;
}
/** Repeated mayDoStatus values are ORed. Invalid sets must not broaden a query. */
export function parseMayDoStatusSet(value: unknown): MayDoStatus[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.some(status => !isMayDoStatus(status))) {
    throw new Error('Choose valid MayDo statuses: suggested, selected, done, dismissed.');
  }
  return MAY_DO_STATUSES.filter(status => values.includes(status));
}
export const mayDoSourceHash = (text: string) => createHash('sha256').update(text).digest('hex');
const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function validMayDos(value: unknown): MayDo[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is MayDo => Boolean(row && typeof row.id === 'string' && typeof row.title === 'string' && typeof row.sourceQuote === 'string' && isMayDoStatus(row.status)));
}

/** Quotes must occur in the supplied transcript. Model-provided IDs, statuses and times are ignored. */
export function mergeMayDos(previous: unknown, candidates: unknown, source: string, cues: PlaybackCue[] = [], now = new Date().toISOString()): MayDo[] {
  if (!Array.isArray(candidates)) throw new Error('The model did not return a MayDos array.');
  const old = validMayDos(previous);
  const result: MayDo[] = [];
  const used = new Set<string>();
  const text = normalized(source);
  for (const candidate of candidates.slice(0, 100)) {
    if (!candidate || typeof candidate.title !== 'string' || typeof candidate.sourceQuote !== 'string') continue;
    const title = candidate.title.trim().slice(0, 300);
    const quote = candidate.sourceQuote.trim().slice(0, 2000);
    const quoteKey = normalized(quote);
    if (!title || quoteKey.length < 8 || !text.includes(quoteKey)) continue;
    const titleKey = normalized(title);
    const available = old.filter(row => !used.has(row.id));
    const existing = available.find(row => normalized(row.title) === titleKey)
      || available.find(row => normalized(row.sourceQuote) === quoteKey);
    const id = existing?.id || 'maydo-' + mayDoSourceHash(titleKey + '\0' + quoteKey).slice(0, 24);
    if (used.has(id) || result.some(row => normalized(row.title) === titleKey)) continue;
    used.add(id);
    const cue = cues.find(row => normalized(row.text).includes(quoteKey) || (normalized(row.text).length > 15 && quoteKey.includes(normalized(row.text))));
    result.push({ id, title, verb: typeof candidate.verb === 'string' ? candidate.verb.trim().toLowerCase().slice(0, 60) : title.split(/\s+/)[0].toLowerCase(), sourceQuote: quote,
      start: cue?.start ?? null, end: cue?.end ?? null, status: existing?.status || 'suggested', createdAt: existing?.createdAt || now, updatedAt: existing?.updatedAt || now });
  }
  // Human decisions survive a changed prompt or a model that no longer suggests the same action.
  for (const row of old) if (row.status !== 'suggested' && !used.has(row.id)) result.push(row);
  return result;
}

export function mayDoSummary(value: unknown) {
  const rows = validMayDos(value);
  return mayDoCounts(rows);
}

/** Runtime presentation metadata; never writes a state marker into the sidecar. */
export function mayDoExtractionState(json: TranscriptionDocument) {
  if (json.mayDoError) return 'error';
  if (!json.mayDoExtraction) return 'none';
  const source = String(json.cleanedTranscription || json.text || '').trim();
  return json.mayDoExtraction.version === MAY_DO_VERSION && json.mayDoExtraction.sourceHash === mayDoSourceHash(source) ? 'current' : 'stale';
}
