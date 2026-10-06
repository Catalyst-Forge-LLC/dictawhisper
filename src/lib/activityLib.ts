import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ActivityStage = 'waiting_for_file' | 'queued_transcription' | 'transcribing' | 'queued_cleanup' | 'cleaning' | 'extracting_maydos' | 'ready' | 'raw_only' | 'failed_transcription' | 'failed_cleanup' | 'failed_maydos' | 'interrupted';
export type ActivityItem = {
  id: string; audioFile: string; jsonFile: string; stage: ActivityStage; updatedAt: number;
  createdAt: number; hasTranscript: boolean; originalName?: string; uploadId?: string;
  eligibleAt?: number; error?: string; reason?: string; resumeStage?: ActivityStage;
};
const unfinished = new Set<ActivityStage>(['waiting_for_file', 'queued_transcription', 'transcribing', 'queued_cleanup', 'cleaning', 'extracting_maydos']);
export const isWorkingStage = (stage: ActivityStage) => unfinished.has(stage);
export const isFailureStage = (stage: ActivityStage) => stage.startsWith('failed_') || stage === 'interrupted';
const fileKey = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

/** Durable summaries, never a queue replay. Restarted work requires explicit recovery. */
export class ActivityStore {
  private items = new Map<string, ActivityItem>();
  private emit: (event: unknown) => void = () => {};
  private revision = 0;
  readonly epoch = randomUUID();
  persistenceError = '';
  private file?: string;
  constructor(file?: string) {
    this.file = file;
    if (file && fs.existsSync(file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved.version !== 1 || !Array.isArray(saved.items)) throw new Error('Invalid Activity history');
        for (const item of saved.items) {
          if (!item.id || !item.jsonFile || !item.audioFile) continue;
          if (unfinished.has(item.stage)) { item.resumeStage = item.stage; item.stage = 'interrupted'; item.error = 'Server stopped before processing finished. Resume explicitly.'; item.updatedAt = Date.now(); }
          this.items.set(item.id, item);
        }
        this.persist();
      } catch (error) { this.persistenceError = `Activity history could not be read: ${String(error)}`; }
    }
  }
  setEmitter(emit: (event: unknown) => void) { this.emit = emit; }
  find(file: string) { const json=file.replace(/\.[^.\\/]+$/, '.json'); return [...this.items.values()].find(item => fileKey(item.jsonFile) === fileKey(json) || fileKey(item.audioFile) === fileKey(file)); }
  byId(id: string) { return this.items.get(id); }
  byUpload(id: string) { return [...this.items.values()].find(item => item.uploadId === id); }
  update(file: string, stage: ActivityStage, patch: Partial<ActivityItem> = {}) {
    const old = this.find(file); const jsonFile = file.replace(/\.[^.\\/]+$/, '.json');
    const item: ActivityItem = { id: old?.id || randomUUID(), audioFile: old?.audioFile || file,
      jsonFile: old?.jsonFile || jsonFile, createdAt: old?.createdAt || Date.now(), hasTranscript: old?.hasTranscript || false,
      ...old, eligibleAt: undefined, error: undefined, reason: undefined, ...patch, stage, updatedAt: Date.now() };
    this.items.set(item.id, item);
    const completed = [...this.items.values()].filter(row => !unfinished.has(row.stage) && !isFailureStage(row.stage)).sort((a,b) => b.updatedAt - a.updatedAt);
    for (const row of completed.slice(200)) if (!row.uploadId) this.items.delete(row.id);
    this.persist();
    this.emit({ epoch: this.epoch, revision: ++this.revision, item });
    return item;
  }
  relocate(oldFile: string, newFile: string) {
    const item = this.find(oldFile); if (!item) return;
    return this.update(oldFile, item.stage, { audioFile: newFile, jsonFile: newFile.replace(/\.[^.\\/]+$/, '.json') });
  }
  snapshot() {
    const items = [...this.items.values()].sort((a,b) => b.updatedAt - a.updatedAt);
    return { epoch: this.epoch, revision: this.revision, items, persistenceError: this.persistenceError,
      working: items.filter(item => unfinished.has(item.stage)).length, failures: items.filter(item => isFailureStage(item.stage)).length };
  }
  private persist() {
    if (!this.file || this.persistenceError.startsWith('Activity history could not be read')) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, items: [...this.items.values()] }), 'utf8');
      fs.renameSync(temporary, this.file); this.persistenceError = '';
    } catch (error) { this.persistenceError = `Activity history could not be saved: ${String(error)}`; }
  }
}
export let activity = new ActivityStore();
export function setActivityStore(store: ActivityStore) { activity = store; }
