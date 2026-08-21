import async from 'async';

export type QueueCallback = (err: any, result?: any) => void;

export type QueueConfig = {
  processor: (task: any, callback: QueueCallback) => void;
  concurrency: number;
  active: boolean;
  onDrain?: () => void;
  onError?: (err: any, task: any) => void;
};

export class Queue {
  private queue: async.QueueObject<any>;
  private config: QueueConfig;
  private name: string;

  constructor(name: string, config: QueueConfig) {
    this.config = config;
    this.name = name;
    this.queue = this.init();

  }

  init(): async.QueueObject<any> {
    const queue = async.queue((task, callback) => {
      let settled = false;
      const done: QueueCallback = (err, result) => {
        if (settled) return;
        settled = true;
        (callback as QueueCallback)(err, result);
      };
      console.log(`[queue-${this.name}] Processing task (${this.queue.length() + 1} remain in queue):`, task);
      try {
        const ret = this.config.processor(task, done);
        Promise.resolve(ret).catch((err) => done(err));
      } catch (err) {
        done(err);
      }
    }, this.config.concurrency);

    // Default or custom drain handler
    queue.drain(this.config.onDrain || (() => {
      console.log(`[queue] All tasks in ${this.name} queue have been processed.`);
    }));

    // Default or custom error handler
    queue.error(this.config.onError || ((err: any, task) => {
      if (err?.err !== null) {
        console.error(`[queue-error] Error processing task in ${this.name} queue:`, err, 'Task:', task);
      } else {
        console.log(`[queue-success] Successfully processed task in ${this.name} queue in ${err.result.elapsed}:`, task);
      }
    }));
    return queue;
  }

  push(task: any, callback?: QueueCallback): void {
    this.queue.push(task, callback as any);
  }

  unshift(task: any, callback?: QueueCallback): void {
    this.queue.unshift(task, callback as any);
  }

  length(): number {
    return this.queue.length();
  }

  running(): number {
    return this.queue.running();
  }

  idle(): boolean {
    return this.queue.idle();
  }
}
