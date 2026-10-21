import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { audioExtensions, probeAudioFile } from './audioLib.ts';
import { assessAudio, type AudioAssessment } from './audioAssessmentLib.ts';

export const enhancementPresets = ['auto', 'quiet', 'uneven', 'noise', 'original'] as const;
export type EnhancementPreset = typeof enhancementPresets[number];
export type AudioLevels = { meanDb: number; peakDb: number; durationSec: number };
export type EnhancementReport = AudioLevels & { gainDb: number; suggestedPreset: EnhancementPreset; selectedPreset?: EnhancementPreset; assessment?: AudioAssessment; warning?: string };

/** Originals may have a different container from the working MP3. Never enhance an enhancement. */
export function findOriginalAudio(jsonFile: string): { file: string; original: boolean } | null {
  const base = jsonFile.replace(/\.json$/i, '');
  for (const suffix of ['_original', '']) for (const ext of audioExtensions) {
    const file = `${base}${suffix}.${ext}`;
    if (fs.existsSync(file)) return { file, original: suffix === '_original' };
  }
  return null;
}

export function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30 * 60_000);
    child.stderr.on('data', data => { output = (output + data.toString()).slice(-65536); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Audio preparation timed out. Your current entry is unchanged.'));
      else if (code !== 0) reject(new Error(`Audio preparation failed: ${output.slice(-800)}`));
      else resolve(output);
    });
  });
}

export async function measureAudio(file: string): Promise<AudioLevels> {
  const probe = await probeAudioFile(file);
  if (!probe.ok) throw new Error(`Cannot read source audio: ${probe.reason}`);
  const log = await ffmpeg(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const meanDb = Number(log.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1]);
  const peakDb = Number(log.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
  if (!Number.isFinite(meanDb) || !Number.isFinite(peakDb)) throw new Error('Could not measure audio levels.');
  return { meanDb, peakDb, durationSec: probe.durationSec! };
}

export function enhancementFilter(preset: EnhancementPreset, levels: AudioLevels) {
  const gainDb = Math.max(0, Math.min(30, -22 - levels.meanDb, -1 - levels.peakDb));
  const leveling = 'dynaudnorm=f=250:g=15:p=0.89:m=10';
  const filter = preset === 'quiet' ? `volume=${gainDb.toFixed(3)}dB`
    : preset === 'uneven' ? leveling
    : preset === 'noise' ? `highpass=f=80,afftdn=nr=8:nf=-50:tn=1,${leveling}` : null;
  return { filter, gainDb: preset === 'quiet' ? gainDb : 0 };
}

/** PCM output: no silence removal, time stretching, MP3 encoding, or source writes. */
export async function enhanceAudio(source: string, output: string, preset: EnhancementPreset): Promise<EnhancementReport> {
  if (!enhancementPresets.includes(preset)) throw new Error('Unknown audio preset.');
  if (path.resolve(source) === path.resolve(output) || fs.existsSync(output)) throw new Error('Audio output must be a new file.');
  const assessment = await assessAudio(source);
  const levels: AudioLevels = assessment;
  const selectedPreset = preset === 'auto' ? assessment.suggestedPreset : preset;
  const { filter, gainDb } = enhancementFilter(selectedPreset, { ...levels, meanDb: assessment.activeMedianDb });
  await ffmpeg(['-n', '-i', source, '-map', '0:a:0', '-vn', ...(filter ? ['-af', filter] : []), '-ar', '16000', '-c:a', 'pcm_s16le', output]);
  const result = await probeAudioFile(output);
  if (!result.ok || Math.abs(result.durationSec! - levels.durationSec) > 0.15) throw new Error('Prepared audio did not preserve the recording duration.');
  return { meanDb: levels.meanDb, peakDb: levels.peakDb, durationSec: levels.durationSec, gainDb, selectedPreset, assessment, suggestedPreset: assessment.suggestedPreset,
    warning: assessment.warnings.join(' ') || (selectedPreset === 'quiet' && gainDb < 1 && levels.meanDb < -30 ? 'Loud peaks limit the boost. Try Uneven volume to lift quieter passages.' : undefined) };
}
