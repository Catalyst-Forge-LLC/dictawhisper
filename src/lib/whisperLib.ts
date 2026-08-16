import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.ts';

const WINDOWS_CUDA_TEARDOWN = 3221226505;

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

export async function whisperTranscribe(
  audioFile: string,
  transcriptionFile: string,
  callback: (payload: { err: Error | null; result?: { transcriptionFile: string; elapsed: string } }) => void,
  modelSize: WhisperModelAlias = resolveWhisperModel()
): Promise<void> {
  const model = resolveWhisperModel(modelSize);
  const python = config.whisper.python;
  const computeType = config.whisper.computeType;
  const device = config.whisper.device;

  console.log(`[whisper] TRANSCRIBING FILE (${model})`, audioFile);
  const startTime = new Date();

  const whisperArgs = [
    transcribeScript,
    '--audio', audioFile,
    '--output', transcriptionFile,
    '--model', model,
    '--device', device,
    '--compute-type', computeType,
  ];

  console.log(`[whisper] calling:\n\n${python} ${whisperArgs.map((a) => JSON.stringify(a)).join(' ')}`);

  const child = spawn(python, ['-u', ...whisperArgs], {
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  const forward = (label: 'stdout' | 'stderr', data: Buffer) => {
    for (const line of data.toString().split(/\r?\n/)) {
      if (line.length) console.log(`[whisper] ${label}: ${line}`);
    }
  };
  child.stdout.on('data', (data: Buffer) => forward('stdout', data));
  child.stderr.on('data', (data: Buffer) => forward('stderr', data));

  child.on('error', (error: Error) => {
    console.log(`[whisper] error: ${error.message}`);
    callback({ err: error });
  });

  child.on('close', async (code: number) => {
    const elapsed = ((new Date().getTime() - startTime.getTime()) / 1000) + 's';
    console.log(`[whisper] child process exited with code ${code}`);
    console.log(`[whisper] Total Elapsed: ${elapsed}`);
    if (code !== 0) {
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
      return;
    }
    callback({ err: null, result: { transcriptionFile, elapsed } });
  });
}
