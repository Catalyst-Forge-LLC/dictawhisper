import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { TranscriptionDocument } from '../types/transcription.ts';
import { listInboxNotes, indexSidecar } from './journalService.ts';
import { activity, isWorkingStage } from './activityLib.ts';
import { assertEntryWritable } from './entryOperationLib.ts';

export function ensureEntryId(json: TranscriptionDocument): string {
  if (typeof json.entryId !== 'string' || !json.entryId.trim()) json.entryId = randomUUID();
  return json.entryId;
}
export function backfillEntryIds() {
  let assigned = 0, current = 0;
  const errors: { file: string; error: string }[] = [];
  for (const note of listInboxNotes({ all: true })) {
    try {
      assertEntryWritable(note.jsonFile);
      if(isWorkingStage(activity.find(note.jsonFile)?.stage || 'ready')) throw new Error('Processing is active; retry identity backfill afterward.');
      const json = JSON.parse(fs.readFileSync(note.jsonFile, 'utf8'));
      if (json.entryId) { current++; continue; }
      ensureEntryId(json);
      const temporary = note.jsonFile + '.' + randomUUID() + '.identity.tmp';
      try {
        fs.writeFileSync(temporary, JSON.stringify(json, null, 2), 'utf8'); fs.renameSync(temporary, note.jsonFile);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      indexSidecar(note.jsonFile); assigned++;
    } catch (error) { errors.push({ file: note.jsonFile, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { assigned, current, failed: errors.length, errors };
}
