import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config.ts';

export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export const audioExtensions = ['webm', 'mp3', 'm4a', 'wav', 'ogg'];

export const audioFileRegex = new RegExp(`\\.(${audioExtensions.join('|')})$`, 'i');

const AUDIO_STAMP =
  /^(?:MTIME_)?(\d{4})-(\d{2})-(\d{2})(?:[_ T](\d{2})[-:](\d{2})[-:](\d{2}))?(Z)?/;

/** Recording time from the basename, or mtime if the name is not dated. */
export function audioRecencyMs(filePath: string): number {
  const match = path.basename(filePath).match(AUDIO_STAMP);
  if (match) {
    const [, year, month, day, hour, minute, second, z] = match;
    const y = Number(year);
    const mo = Number(month) - 1;
    const d = Number(day);
    const h = Number(hour || 0);
    const mi = Number(minute || 0);
    const s = Number(second || 0);
    const ms = z ? Date.UTC(y, mo, d, h, mi, s) : new Date(y, mo, d, h, mi, s).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

export function compareAudioNewestFirst(a: string, b: string): number {
  return audioRecencyMs(b) - audioRecencyMs(a);
}

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

export function audioContentType(filePath: string): string {
  return AUDIO_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/** Working audio next to a sidecar JSON (not `_original` / `_clean`). */
export function findAudioForSidecar(jsonFile: string): string | null {
  const parsed = path.parse(jsonFile);
  const base = path.join(parsed.dir, parsed.name);
  for (const ext of audioExtensions) {
    const candidate = `${base}.${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of audioExtensions) {
    const candidate = `${base}_original.${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function saveAudioFile(dataUrl: string, clipName: string): string {
  const data = dataUrl.replace(/data:.*?;base64,/i, '');
  return saveUploadedAudio(Buffer.from(data, 'base64'), `${clipName || 'voice-recording'}.webm`, clipName);
}

/** Recognize supported containers independently of extension/MIME metadata. */
export function detectAudioExtension(buffer: Buffer): string | null {
  if (buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WAVE') return '.wav';
  if (buffer.subarray(0,4).toString() === 'OggS') return '.ogg';
  if (buffer.subarray(0,3).toString() === 'ID3' || (buffer.length > 1 && buffer[0] === 255 && (buffer[1] & 224) === 224)) return '.mp3';
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3) return '.webm';
  if (buffer.subarray(4,8).toString() === 'ftyp') return '.m4a';
  return null;
}

export function saveUploadedAudio(buffer: Buffer, originalName: string, clipName?: string, destination = config.watch.browserDropFolder): string {
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) throw new Error('Audio must be nonempty and at most 80 MiB.');
  const detected = detectAudioExtension(buffer);
  if (!detected) throw new Error('Unsupported audio container. Use WebM, MP3, M4A, WAV, or OGG.');
  fs.mkdirSync(destination, { recursive: true });
  const originalExt = path.extname(originalName || '');
  const base = (clipName || path.basename(originalName || 'voice-recording', originalExt) || 'voice-recording')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 160) || 'voice-recording';
  const safeBase = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? '_' + base : base;
  for (let suffix = 1; suffix < 10_000; suffix++) {
    const file = path.join(destination, `${safeBase}${suffix > 1 ? ' (' + suffix + ')' : ''}${detected}`);
    if (fs.existsSync(file.replace(/\.[^.]+$/, '.json'))) continue;
    try { fs.writeFileSync(file, buffer, { flag: 'wx' }); return file; }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Too many files have this name. Choose another label.');
}

export type AudioProbe = {
  ok: boolean;
  reason: string;
  durationSec?: number;
  size: number;
};

const MIN_AUDIO_BYTES = 512;

/** Cheap ffprobe: reject stubs, empty files, and containers with no duration. */
export function probeAudioFile(filePath: string): Promise<AudioProbe> {
  if (!fs.existsSync(filePath)) return Promise.resolve({ ok: false, reason: 'missing', size: 0 });
  const size = fs.statSync(filePath).size;
  if (size < MIN_AUDIO_BYTES) {
    return Promise.resolve({ ok: false, reason: `too small (${size} bytes)`, size });
  }
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, reason: 'ffprobe timeout', size });
    }, 15_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: error.message || 'ffprobe failed', size });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const line = String(stderr || stdout || 'ffprobe failed')
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop();
        resolve({ ok: false, reason: line || 'ffprobe failed', size });
        return;
      }
      try {
        const duration = Number(JSON.parse(stdout || '{}')?.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          resolve({ ok: false, reason: 'no duration', size });
          return;
        }
        resolve({ ok: true, reason: `${duration.toFixed(1)}s`, durationSec: duration, size });
      } catch {
        resolve({ ok: false, reason: 'ffprobe json', size });
      }
    });
  });
}

function unlinkIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // leftover cleanup is best-effort
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Denoise to a working `.mp3`. Keeps `*_original` with the source bytes.
 * Returns the path Whisper should read (may differ from `file` if the ext changed).
 */
export async function cleanAudioFile(file: string, cleanAgain = false): Promise<string> {
  const parsed = path.parse(file);
  const base = path.join(parsed.dir, parsed.name.replace(/_original$/i, ''));
  const workingMp3 = `${base}.mp3`;
  const originalFile = `${base}_original${parsed.ext}`;
  const tmpMp3 = path.join(os.tmpdir(), `dicta-clean-${Date.now()}-${path.basename(base)}.mp3`);

  unlinkIfExists(`${base}_clean${parsed.ext}`);
  unlinkIfExists(`${base}_clean.mp3`);

  if (fs.existsSync(originalFile) && fs.existsSync(workingMp3) && !cleanAgain) {
    return workingMp3;
  }

  const source = fs.existsSync(originalFile) && cleanAgain ? originalFile : file;
  const probe = await probeAudioFile(source);
  if (!probe.ok) {
    throw new Error(`unreadable audio: ${probe.reason}`);
  }
  await runFfmpeg([
    '-y',
    '-i',
    source,
    '-af',
    'silenceremove=1:0:-50dB,afftdn=nr=15:nf=-40,highpass=f=200,volume=1.5',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    tmpMp3,
  ]);

  if (!fs.existsSync(originalFile)) {
    fs.copyFileSync(file, originalFile);
  }
  fs.copyFileSync(tmpMp3, workingMp3);
  unlinkIfExists(tmpMp3);
  if (path.resolve(file) !== path.resolve(workingMp3)) {
    unlinkIfExists(file);
  }
  console.log(`[ffmpeg] cleaned working file ${workingMp3}`);
  return workingMp3;
}
