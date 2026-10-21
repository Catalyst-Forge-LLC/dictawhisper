import { spawn } from 'node:child_process';
import { probeAudioFile } from './audioLib.ts';

export type AudioAssessment = {
  version: 1; durationSec: number; meanDb: number; peakDb: number;
  activeMedianDb: number; activeSpreadDb: number; channelDifferenceDb: number;
  nearFullScaleFraction: number; energeticRanges: { start: number; end: number }[];
  suggestedPreset: 'original' | 'quiet' | 'uneven'; reasons: string[]; warnings: string[];
};
const db = (value: number) => Math.max(-120, 20 * Math.log10(Math.max(value, 1e-6)));
const rounded = (n: number) => Math.round(n * 100) / 100;
const percentile = (sorted: number[], p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? -120;

/** One-second energy windows, not speech recognition or an intelligibility score. */
export function assessWindows(windows: number[], peak: number, channelEnergy: number[], frames: number, nearFullScale: number): AudioAssessment {
  const sorted = windows.slice().sort((a, b) => a - b);
  const threshold = Math.max(-65, percentile(sorted, .9) - 35);
  const active = sorted.filter(level => level > threshold);
  const median = percentile(active, .5), spread = percentile(active, .9) - percentile(active, .1);
  const mean = db(Math.sqrt(channelEnergy.reduce((sum, n) => sum + n, 0) / Math.max(1, frames * channelEnergy.length)));
  const channelDb = channelEnergy.map(sum => db(Math.sqrt(sum / Math.max(1, frames))));
  const channelDifference = Math.max(...channelDb) - Math.min(...channelDb);
  const peakDb = db(peak), warnings: string[] = [], reasons: string[] = [];
  let preset: AudioAssessment['suggestedPreset'] = 'original';
  if (peakDb < -65 || !active.length) warnings.push('Very little signal was detected. Amplification cannot recover speech that was not captured.');
  else if (spread >= 14 && percentile(active, .1) < -30) { preset = 'uneven'; reasons.push('Audible levels vary substantially across the recording.'); }
  else if (median < -28) {
    preset = peakDb < -4 ? 'quiet' : 'uneven';
    reasons.push(preset === 'quiet' ? 'Consistently low levels have room for a clean gain increase.' : 'Quiet passages and loud peaks need different gain.');
  } else reasons.push('Levels are adequate; keep the signal unfiltered.');
  if (channelDifference > 18) warnings.push('The decoded channels have very different levels. Listen for a missing or weak channel.');
  if (nearFullScale / Math.max(1, frames * channelEnergy.length) > .001) warnings.push('Frequent near-full-scale samples may indicate distortion. Normalization cannot repair clipping.');
  const ranges: { start: number; end: number }[] = [];
  windows.forEach((level, second) => {
    if (level <= threshold) return;
    const last = ranges.at(-1);
    if (last && last.end === second) last.end = second + 1;
    else ranges.push({ start: second, end: second + 1 });
  });
  return { version: 1, durationSec: frames / 16000, meanDb: rounded(mean), peakDb: rounded(peakDb), activeMedianDb: rounded(median), activeSpreadDb: rounded(spread), channelDifferenceDb: rounded(channelDifference), nearFullScaleFraction: nearFullScale / Math.max(1, frames * channelEnergy.length), energeticRanges: ranges.slice(0, 2000), suggestedPreset: preset, reasons, warnings };
}

/** Decode to a bounded streaming PCM buffer; retain only one number per second. */
export async function assessAudio(file: string): Promise<AudioAssessment> {
  const probe = await probeAudioFile(file);
  if (!probe.ok) throw new Error('Audio assessment failed: ' + probe.reason);
  const channels = probe.channels || 1;
  if (!Number.isInteger(channels) || channels < 1 || channels > 32) throw new Error('Unsupported audio channel count.');
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', String(channels), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    let tail = Buffer.alloc(0), stderr = '', frames = 0, peak = 0, near = 0, windowEnergy = 0, windowFrames = 0, timedOut = false;
    const energy = Array<number>(channels).fill(0), windows: number[] = [];
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30 * 60_000);
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-800); });
    child.stdout.on('data', (chunk: Buffer) => {
      const buffer = tail.length ? Buffer.concat([tail, chunk]) : chunk;
      const end = buffer.length - buffer.length % (channels * 4);
      for (let i = 0; i < end; i += channels * 4) {
        for (let channel = 0; channel < channels; channel++) {
          const sample = buffer.readFloatLE(i + channel * 4), square = sample * sample;
          energy[channel] += square; windowEnergy += square; peak = Math.max(peak, Math.abs(sample));
          if (Math.abs(sample) >= .999) near++;
        }
        frames++; windowFrames++;
        if (windowFrames === 16000) { windows.push(db(Math.sqrt(windowEnergy / (windowFrames * channels)))); windowEnergy = 0; windowFrames = 0; }
      }
      tail = Buffer.from(buffer.subarray(end));
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut || code !== 0 || !frames) { reject(new Error(`Audio assessment failed: ${timedOut ? 'timed out' : stderr || 'no decoded samples'}`)); return; }
      if (windowFrames) windows.push(db(Math.sqrt(windowEnergy / (windowFrames * channels))));
      resolve(assessWindows(windows, peak, energy, frames, near));
    });
  });
}
