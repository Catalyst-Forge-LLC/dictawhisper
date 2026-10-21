import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { whisperTranscribe, resolveWhisperModel } from './whisperLib.ts';
import { ffmpeg, type EnhancementReport } from './audioEnhancementLib.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';

export const TRANSCRIPTION_PIPELINE_VERSION = 1;
export type QualityIssue = { kind: 'empty' | 'timing' | 'repetition' | 'uncertain' | 'uncovered_audio' | 'audio'; start?: number; end?: number; message: string; alternative?: string; retryError?: string };
export type TranscriptionQuality = { version: number; createdAt: string; model: string; vadFilter: boolean; preparation?: EnhancementReport; issues: QualityIssue[]; source?: { size: number; mtimeMs: number; sha256?: string }; batchId?: string };
export type AsrRunner = (audio: string, output: string, model: string, vad: boolean) => Promise<void>;
export const runWhisper: AsrRunner = (audio, output, model, vad) => new Promise((resolve, reject) => {
  void whisperTranscribe(audio, output, payload => payload.err ? reject(payload.err) : resolve(), resolveWhisperModel(model), { vadFilter: vad });
});

export function inspectTranscript(json: TranscriptionDocument, report?: EnhancementReport): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const duration = report?.durationSec ?? Number(json.whisper?.duration ?? Infinity);
  const segments = json.segments || [];
  if (!json.text?.trim() || !segments.length) issues.push({ kind: 'empty', start: 0, end: Math.min(30, duration), message: 'No timed speech was returned.' });
  let previous = -1;
  const repeated = new Map<string, number>();
  for (const row of segments) {
    if (!Number.isFinite(row.start) || !Number.isFinite(row.end) || row.start < 0 || row.end < row.start || row.end > duration + .5 || row.start < previous - 1) issues.push({ kind: 'timing', message: 'Some timestamps are outside the recording or out of order.' });
    previous = row.start;
    const text = row.text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
    const count = (repeated.get(text) || 0) + 1; repeated.set(text, count);
    if ((text.length > 15 && count === 3) || (row.compression_ratio ?? 0) > 2.4) issues.push({ kind: 'repetition', start: row.start, end: row.end, message: 'Repeated wording may need a listen.' });
    else if ((row.avg_logprob ?? 0) < -1 || (row.no_speech_prob ?? 0) > .65) issues.push({ kind: 'uncertain', start: row.start, end: row.end, message: 'Whisper reported uncertain speech here.' });
  }
  // Energy can be music or noise. Never label this as missed speech or insert invented words.
  for (const range of report?.assessment?.energeticRanges || []) {
    let cursor = range.start;
    for (const row of segments) {
      if (row.end <= cursor || row.start >= range.end) continue;
      if (row.start - cursor >= 10) issues.push({ kind: 'uncovered_audio', start: cursor, end: row.start, message: 'Audible signal has no transcript here; it may be speech, music or noise.' });
      cursor = Math.max(cursor, row.end);
    }
    if (range.end - cursor >= 10) issues.push({ kind: 'uncovered_audio', start: cursor, end: Math.min(range.end, duration), message: 'Audible signal has no transcript here; it may be speech, music or noise.' });
  }
  for (const message of report?.assessment?.warnings || []) issues.push({ kind: 'audio', message });
  return issues.slice(0, 100);
}

/** Keep the first pass intact; bounded alternate listens are evidence for review, never a synthetic merge. */
export async function transcribeWithQuality(audio: string, output: string, model: string, vad = false, report?: EnhancementReport, runner: AsrRunner = runWhisper) {
  await runner(audio, output, model, vad);
  const json = JSON.parse(fs.readFileSync(output, 'utf8')) as TranscriptionDocument;
  const issues = inspectTranscript(json, report);
  const attempted: { start: number; end: number }[] = [];
  for (const issue of issues) {
    if (attempted.length >= 3 || issue.start === undefined || issue.end === undefined) continue;
    const start = Math.max(0, issue.start - 2), end = Math.min(report?.durationSec ?? Infinity, start + 45, issue.end + 2);
    if (!Number.isFinite(end) || end <= start || attempted.some(row => row.start <= start && row.end >= end)) continue;
    attempted.push({ start, end });
    const clip = path.join(path.dirname(output), randomUUID() + '.wav'), alternate = clip + '.json';
    try {
      await ffmpeg(['-n', '-ss', String(start), '-i', audio, '-t', String(end - start), '-vn', '-c:a', 'pcm_s16le', clip]);
      await runner(clip, alternate, model, !vad);
      issue.alternative = String(JSON.parse(fs.readFileSync(alternate, 'utf8')).text || '').slice(0, 5000);
    } catch (error) { issue.retryError = error instanceof Error ? error.message : String(error); }
    finally { for (const file of [clip, alternate]) if (fs.existsSync(file)) fs.unlinkSync(file); }
  }
  json.transcriptionQuality = { version: TRANSCRIPTION_PIPELINE_VERSION, createdAt: new Date().toISOString(), model, vadFilter: vad, preparation: report, issues };
  fs.writeFileSync(output, JSON.stringify(json, null, 2), 'utf8');
}
