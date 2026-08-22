import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { config } from '../config.ts';
import { buildWhisperInitialPrompt } from '../prompts/whisperInitial.ts';

const WINDOWS_CUDA_TEARDOWN = 3221226505;
const WORKER_READY_MS = 180_000;
const JOB_TIMEOUT_MS = 45 * 60 * 1000;
const SHUTDOWN_MS = 8_000;

export type WhisperWorkerStatus = 'off' | 'starting' | 'ready' | 'down';

type WhisperCallback = (payload: {
  err: Error | null;
  result?: { transcriptionFile: string; elapsed: string };
}) => void;

type PendingJob = {
  id: string;
  transcriptionFile: string;
  startTime: number;
  resolve: (elapsed: string) => void;
  reject: (error: Error) => void;
};

function transcriptionLooksComplete(transcriptionFile: string): boolean {
  try {
    if (!fs.existsSync(transcriptionFile)) return false;
    const json = JSON.parse(fs.readFileSync(transcriptionFile, 'utf-8'));
    return typeof json?.text === 'string' && json.text.trim().length > 0 && Array.isArray(json.segments);
  } catch {
    return false;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const transcribeScript = path.resolve(__dirname, '../../scripts/transcribe_faster_whisper.py');

function pythonEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  };
}

export type WhisperModelAlias = 'large-v3' | 'large' | 'turbo' | 'large-v3-turbo';

const MODEL_ALIASES: Record<string, WhisperModelAlias> = {
  large: 'large-v3',
  'large-v3': 'large-v3',
  turbo: 'turbo',
  'large-v3-turbo': 'turbo',
};

export function resolveWhisperModel(raw?: string | null): WhisperModelAlias {
  const key = (raw ?? config.whisper.model ?? 'large-v3').trim().toLowerCase();
  const resolved = MODEL_ALIASES[key];
  if (!resolved) {
    console.warn(`[whisper] Unknown model="${key}", falling back to large-v3`);
    return 'large-v3';
  }
  return resolved;
}

function workerKey(model: string, device: string, computeType: string): string {
  return `${model}|${device}|${computeType}`;
}

function forwardLines(label: 'stdout' | 'stderr', data: Buffer): void {
  for (const line of data.toString().split(/\r?\n/)) {
    if (line.length) console.log(`[whisper] ${label}: ${line}`);
  }
}

function spawnOneShot(
  audioFile: string,
  transcriptionFile: string,
  model: WhisperModelAlias,
  callback: WhisperCallback
): void {
  const python = config.whisper.python;
  const computeType = config.whisper.computeType;
  const device = config.whisper.device;
  const startTime = new Date();
  const whisperArgs = [
    transcribeScript,
    '--audio', audioFile,
    '--output', transcriptionFile,
    '--model', model,
    '--device', device,
    '--compute-type', computeType,
    '--initial-prompt', buildWhisperInitialPrompt(config.whisper.promptTerms),
  ];

  console.log(`[whisper] one-shot ${python} ${whisperArgs.map((arg) => JSON.stringify(arg)).join(' ')}`);

  const child = spawn(python, ['-u', ...whisperArgs], {
    windowsHide: true,
    env: pythonEnv(),
  });

  child.stdout.on('data', (data: Buffer) => forwardLines('stdout', data));
  child.stderr.on('data', (data: Buffer) => forwardLines('stderr', data));

  child.on('error', (error: Error) => {
    console.log(`[whisper] error: ${error.message}`);
    callback({ err: error });
  });

  child.on('close', (code: number) => {
    const elapsed = `${(Date.now() - startTime.getTime()) / 1000}s`;
    console.log(`[whisper] child process exited with code ${code}`);
    console.log(`[whisper] Total Elapsed: ${elapsed}`);
    if (code === 0) {
      callback({ err: null, result: { transcriptionFile, elapsed } });
      return;
    }
    if (transcriptionLooksComplete(transcriptionFile)) {
      const hint = code === WINDOWS_CUDA_TEARDOWN ? ' (CUDA teardown crash; transcript is complete)' : '';
      console.log(`[whisper] process crashed with ${code}${hint}; keeping existing JSON`);
      callback({ err: null, result: { transcriptionFile, elapsed } });
      return;
    }
    callback({
      err: new Error(`faster-whisper exited with code ${code}`),
      result: { transcriptionFile, elapsed },
    });
  });
}

let worker: ChildProcess | null = null;
let workerRl: readline.Interface | null = null;
let status: WhisperWorkerStatus = 'off';
let currentKey = '';
let startPromise: Promise<void> | null = null;
let jobChain: Promise<void> = Promise.resolve();
let jobSeq = 0;
const pending = new Map<string, PendingJob>();

export function getWhisperWorkerStatus(): WhisperWorkerStatus {
  return status;
}

function failPending(error: Error): void {
  const jobs = [...pending.values()];
  pending.clear();
  for (const job of jobs) job.reject(error);
}

function handleWorkerMessage(raw: string): void {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    if (raw.length) console.log(`[whisper] stdout: ${raw}`);
    return;
  }

  const type = String(message.type || '');
  if (type === 'ready') {
    console.log(`[whisper] worker ready model=${message.model} device=${message.device}`);
    return;
  }
  if (type === 'progress') {
    const pct = message.pct == null ? '?' : message.pct;
    const text = typeof message.text === 'string' ? message.text : '';
    console.log(`[whisper] ${pct}% (${message.start}-${message.end}s) ${text}`);
    return;
  }
  if (type === 'error') {
    console.warn(`[whisper] worker: ${message.error || 'unknown error'}`);
    return;
  }
  if (type !== 'done') return;

  const id = String(message.id || '');
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  const elapsed = `${(Date.now() - job.startTime) / 1000}s`;
  if (message.ok) {
    console.log(`[whisper] worker done ${elapsed} chars=${message.chars} segments=${message.segments}`);
    job.resolve(elapsed);
    return;
  }
  job.reject(new Error(String(message.error || 'whisper worker job failed')));
}

function attachWorker(child: ChildProcess): void {
  workerRl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
  workerRl.on('line', handleWorkerMessage);
  child.stderr?.on('data', (data: Buffer) => forwardLines('stderr', data));
  child.on('error', (error: Error) => {
    console.warn(`[whisper] worker error: ${error.message}`);
    status = 'down';
    failPending(error);
  });
  child.on('close', (code: number) => {
    console.log(`[whisper] worker exited with code ${code}`);
    workerRl?.close();
    workerRl = null;
    worker = null;
    currentKey = '';
    startPromise = null;
    status = 'down';
    const jobs = [...pending.values()];
    pending.clear();
    for (const job of jobs) {
      if (transcriptionLooksComplete(job.transcriptionFile)) {
        const hint = code === WINDOWS_CUDA_TEARDOWN ? ' (CUDA teardown crash; transcript is complete)' : '';
        console.log(`[whisper] worker crashed with ${code}${hint}; keeping existing JSON`);
        job.resolve(`${(Date.now() - job.startTime) / 1000}s`);
        continue;
      }
      job.reject(new Error(`whisper worker exited with code ${code}`));
    }
  });
}

function sendWorker(payload: Record<string, unknown>): void {
  if (!worker?.stdin?.writable) throw new Error('whisper worker stdin is not writable');
  worker.stdin.write(`${JSON.stringify(payload)}\n`);
}

export async function startWhisperWorker(
  modelSize: WhisperModelAlias = resolveWhisperModel()
): Promise<void> {
  const model = resolveWhisperModel(modelSize);
  const device = config.whisper.device;
  const computeType = config.whisper.computeType;
  const key = workerKey(model, device, computeType);

  if (status === 'ready' && worker && currentKey === key) return;
  if (startPromise && currentKey === key) return startPromise;
  if (worker && currentKey !== key) await stopWhisperWorker();

  currentKey = key;
  status = 'starting';
  startPromise = new Promise<void>((resolve, reject) => {
    console.log(`[whisper] starting worker (${model} ${device} ${computeType})`);
    const child = spawn(
      config.whisper.python,
      [
        '-u',
        transcribeScript,
        '--worker',
        '--model',
        model,
        '--device',
        device,
        '--compute-type',
        computeType,
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: pythonEnv(),
      }
    );
    worker = child;
    attachWorker(child);

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`whisper worker did not become ready in ${WORKER_READY_MS / 1000}s`));
      void stopWhisperWorker();
    }, WORKER_READY_MS);

    const onLine = (line: string) => {
      try {
        const message = JSON.parse(line) as { type?: string };
        if (message.type !== 'ready') return;
        cleanup();
        status = 'ready';
        resolve();
      } catch {
        // non-JSON during load is forwarded by handleWorkerMessage
      }
    };

    const onClose = (code: number | null) => {
      cleanup();
      reject(new Error(`whisper worker exited during startup (code ${code})`));
    };

    function cleanup() {
      clearTimeout(timer);
      workerRl?.off('line', onLine);
      child.off('close', onClose);
    }

    workerRl?.on('line', onLine);
    child.once('close', onClose);
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
  }).finally(() => {
    if (status !== 'ready') startPromise = null;
  });

  return startPromise;
}

export async function stopWhisperWorker(): Promise<void> {
  const child = worker;
  if (!child) {
    if (status === 'ready' || status === 'starting') status = 'off';
    return;
  }
  try {
    sendWorker({ cmd: 'shutdown' });
  } catch {
    // process already gone
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed) child.kill();
      resolve();
    }, SHUTDOWN_MS);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  worker = null;
  workerRl = null;
  currentKey = '';
  startPromise = null;
  status = 'off';
}

async function transcribeViaWorker(
  audioFile: string,
  transcriptionFile: string,
  model: WhisperModelAlias
): Promise<string> {
  await startWhisperWorker(model);
  const id = String(++jobSeq);
  const elapsed = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`whisper worker job timed out after ${JOB_TIMEOUT_MS / 1000}s`));
    }, JOB_TIMEOUT_MS);
    pending.set(id, {
      id,
      transcriptionFile,
      startTime: Date.now(),
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      sendWorker({
        id,
        cmd: 'transcribe',
        audio: audioFile,
        output: transcriptionFile,
        model,
        device: config.whisper.device,
        compute_type: config.whisper.computeType,
        initial_prompt: buildWhisperInitialPrompt(config.whisper.promptTerms),
      });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return elapsed;
}

function enqueueJob<T>(fn: () => Promise<T>): Promise<T> {
  const run = jobChain.then(fn, fn);
  jobChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function whisperTranscribe(
  audioFile: string,
  transcriptionFile: string,
  callback: WhisperCallback,
  modelSize: WhisperModelAlias = resolveWhisperModel()
): Promise<void> {
  const model = resolveWhisperModel(modelSize);
  console.log(`[whisper] TRANSCRIBING FILE (${model})`, audioFile);

  try {
    const elapsed = await enqueueJob(() => transcribeViaWorker(audioFile, transcriptionFile, model));
    callback({ err: null, result: { transcriptionFile, elapsed } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[whisper] worker failed (${message}); falling back to one-shot`);
    spawnOneShot(audioFile, transcriptionFile, model, callback);
  }
}
