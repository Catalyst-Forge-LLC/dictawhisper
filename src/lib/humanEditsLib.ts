import type { TranscriptionDocument } from '../types/transcription.ts';

/** Restore human-owned values after awaiting a model, using the current disk copy. */
export function preserveHumanEdits(output: TranscriptionDocument, initial: TranscriptionDocument, fresh: TranscriptionDocument) {
  for (const key of ['entryId','recordedDate','recordedAt','recordedAtSource'] as const) {
    if (fresh[key] !== undefined) output[key] = fresh[key]; else delete output[key];
  }
  output.displayTitle = fresh.displayTitle;
  output.starred = fresh.starred;
  if (fresh.tagsEditedAt || JSON.stringify(fresh.tags) !== JSON.stringify(initial.tags)) output.tags = fresh.tags;
  else if (fresh.tags?.length) output.tags = [...new Set([...fresh.tags, ...(output.tags || [])])];
  // Legacy sidecars have no ownership marker. Retain existing tags rather than
  // silently removing a possibly human-supplied tag during reprocessing.
  output.tagsEditedAt = fresh.tagsEditedAt;
  return output;
}
