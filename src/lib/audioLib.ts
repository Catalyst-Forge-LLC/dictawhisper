import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config.ts';

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
  const folder = config.watch.browserDropFolder;
  fs.mkdirSync(folder, { recursive: true });
  const safeName = (clipName || 'voice-recording').replace(/[<>:"/\\|?*]/g, '-');
  const filePath = path.join(folder, `${safeName}.webm`);
  const data = dataUrl.replace(/data:.*?;base64,/i, '');
  console.log('[save-audio-file] Saving Audio File', { filePath, dataLength: data.length });
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

export function saveUploadedAudio(buffer: Buffer, originalName: string, clipName?: string): string {
  const folder = config.watch.browserDropFolder;
  fs.mkdirSync(folder, { recursive: true });
  const ext = path.extname(originalName || '').toLowerCase() || '.webm';
  const safeExt = audioExtensions.includes(ext.slice(1)) ? ext : '.webm';
  const base = (clipName || path.basename(originalName || 'voice-recording', ext) || 'voice-recording').replace(
    /[<>:"/\\|?*]/g,
    '-'
  );
  const filePath = path.join(folder, `${base}${safeExt}`);
  fs.writeFileSync(filePath, buffer);
  console.log('[save-audio-file] saved upload', { filePath, bytes: buffer.length });
  return filePath;
}

export type AudioProbe = {
  ok: boolean;
  reason: string;
  durationSec?: number;
  size: number;
};

const MIN_AUDIO_BYTES = 512;

/** Cheap ffprobe: reject stubs, empty files, and containers with no duration. */
export function probeAudioFile(filePath: string): AudioProbe {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing', size: 0 };
  const size = fs.statSync(filePath).size;
  if (size < MIN_AUDIO_BYTES) return { ok: false, reason: `too small (${size} bytes)`, size };
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', filePath],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  );
  if (result.status !== 0) {
    const line = String(result.stderr || result.stdout || 'ffprobe failed')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    return { ok: false, reason: line || 'ffprobe failed', size };
  }
  try {
    const duration = Number(JSON.parse(result.stdout || '{}')?.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, reason: 'no duration', size };
    }
    return { ok: true, reason: `${duration.toFixed(1)}s`, durationSec: duration, size };
  } catch {
    return { ok: false, reason: 'ffprobe json', size };
  }
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
  const probe = probeAudioFile(source);
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
