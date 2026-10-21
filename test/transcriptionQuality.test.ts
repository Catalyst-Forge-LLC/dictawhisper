import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assessAudio, assessWindows } from '../src/lib/audioAssessmentLib.ts';
import { enhanceAudio, measureAudio } from '../src/lib/audioEnhancementLib.ts';
import { inspectTranscript, transcribeWithQuality } from '../src/lib/transcriptionQualityLib.ts';

test('assessment selects quiet, varying, adequate and near-silent signals conservatively', () => {
  const make = (windows: number[], peak: number) => assessWindows(windows, peak, [1, 1], 16000 * windows.length, 0);
  assert.equal(make([-40, -39, -40], .05).suggestedPreset, 'quiet');
  assert.equal(make(Array.from({ length: 40 }, (_, i) => i < 20 ? -42 : -20), .7).suggestedPreset, 'uneven');
  assert.equal(make([-20, -21, -19], .7).suggestedPreset, 'original');
  assert.equal(make([-100, -100], .00001).suggestedPreset, 'original');
  assert.ok(make([-100, -100], .00001).warnings.length);
  assert.equal(make([-90, -90, -20, -20, -20, -20, -20, -20, -20], .7).suggestedPreset, 'original', 'silence alone must not select leveling');
});

test('diagnostics keep genuine uncertainty distinct from presumed missing speech', () => {
  const issues = inspectTranscript({ text: 'Possibly speech', segments: [{ start: 0, end: 1, text: 'Possibly speech', avg_logprob: -1.5 }] }, { meanDb: -25, peakDb: -5, durationSec: 30, gainDb: 0, suggestedPreset: 'original', assessment: { energeticRanges: [{ start: 0, end: 30 }], warnings: [] } as any });
  assert.deepEqual(issues.map(row => row.kind), ['uncertain', 'uncovered_audio']);
  assert.match(issues[1].message, /music or noise/);
  assert.equal(inspectTranscript({ text: 'Hello', segments: [{ start: 0, end: 2, text: 'Hello' }] }).length, 0);
});

test('real PCM assessment and bounded alternate passes retain the primary text and duration', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-quality-'));
  try {
    const source = path.join(root, 'source.wav'), prepared = path.join(root, 'prepared.wav'), output = path.join(root, 'candidate.json');
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=16000', '-af', 'volume=0.03', source], { windowsHide: true });
    assert.equal(made.status, 0, String(made.stderr));
    const before = fs.readFileSync(source), assessment = await assessAudio(source);
    const measured = await measureAudio(source);
    assert.ok(Math.abs(assessment.peakDb - measured.peakDb) < .15, 'mono channel conversion must not understate peak headroom');
    assert.equal(assessment.suggestedPreset, 'quiet'); assert.equal(assessment.durationSec, 4);
    const report = await enhanceAudio(source, prepared, 'auto'); assert.equal(report.selectedPreset, 'quiet');
    let calls = 0;
    await transcribeWithQuality(prepared, output, 'large-v3', false, report, async (_audio, out, _model, vad) => {
      calls++; assert.equal(vad, calls > 1);
      fs.writeFileSync(out, JSON.stringify({ text: calls === 1 ? 'Primary words' : 'Alternative words', segments: [{ start: 0, end: 3, text: 'Primary words', avg_logprob: -1.2 }] }));
    });
    const candidate = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(calls, 2); assert.equal(candidate.text, 'Primary words');
    assert.equal(candidate.transcriptionQuality.issues[0].alternative, 'Alternative words');
    assert.deepEqual(fs.readFileSync(source), before);
    assert.deepEqual(fs.readdirSync(root).sort(), ['candidate.json', 'prepared.wav', 'source.wav']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
