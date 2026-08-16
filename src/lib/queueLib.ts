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

    queueMap[name] = new Queue(name, config);
    console.log(`[queue] Initialized queue: ${name} with concurrency ${config.concurrency}`);
  }

  q = queueMap;
}

