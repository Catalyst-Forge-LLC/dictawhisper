import fs from 'node:fs';
import { activity } from './activityLib.ts';
import { Queue, type QueueConfig } from '../classes/Queue.ts';

export let q: Record<string, Queue> = {};

export function initQueues(queues: Record<string, QueueConfig>): void {
  if (!queues || typeof queues !== 'object') {
    throw new Error('Invalid queues configuration');
  }

  const queueMap: Record<string, Queue> = {};

  for (const [name, config] of Object.entries(queues)) {
    if (!config.active) {
      console.log(`[queue] Skipping inactive queue: ${name}`);
      continue;
    }
    if (!config.processor || typeof config.processor !== 'function') {
      throw new Error(`Queue ${name} is missing a processor function`);
    }
    if (typeof config.concurrency !== 'number' || config.concurrency <= 0) {
      throw new Error(`Queue ${name} has an invalid concurrency value`);
    }

    queueMap[name] = new Queue(name, { ...config, processor: (task, callback) => {
      if (name === 'transcription' || name === 'processing') activity.update(task.transcriptionFile || task.file, name === 'transcription' ? 'transcribing' : 'cleaning', { audioFile: task.audioFile || task.file });
      let settled = false;
      const done = (payload: any, result?: any) => {
        if (settled) return; settled = true;
        const error = payload instanceof Error ? payload : payload && Object.hasOwn(payload, 'err') ? payload.err : payload ? new Error(String(payload)) : null;
        const output = result || payload?.result;
        if (error && (name === 'transcription' || name === 'processing')) activity.update(task.transcriptionFile || task.file, name === 'transcription' ? 'failed_transcription' : 'failed_cleanup', { error: error.message || String(error), hasTranscript: Boolean(activity.find(task.transcriptionFile || task.file)?.hasTranscript) || name === 'processing' });
        if (!error && name === 'processing') {
          let json: any = {}; try { json = JSON.parse(fs.readFileSync(task.file.replace(/\.[^.\\/]+$/, '.json'), 'utf8')); } catch {}
          activity.update(task.file, json.mayDoError ? 'failed_maydos' : json.cleanedTranscription ? 'ready' : 'raw_only', { hasTranscript: true, error: json.mayDoError });
        }
        callback(error, output);
      };
      try { const work = config.processor(task, done); Promise.resolve(work).catch(done); } catch (error) { done(error); }
    } });
    console.log(`[queue] Initialized queue: ${name} with concurrency ${config.concurrency}`);
  }

  q = queueMap;
}
