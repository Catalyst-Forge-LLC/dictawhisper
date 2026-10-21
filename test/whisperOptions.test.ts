import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../src/config.ts';
import { whisperTranscribe, stopWhisperWorker } from '../src/lib/whisperLib.ts';
import { buildWhisperInitialPrompt } from '../src/prompts/whisperInitial.ts';

test('Whisper context is empty by default and contains only configured vocabulary', () => {
  assert.equal(buildWhisperInitialPrompt(), '');
  assert.equal(buildWhisperInitialPrompt([' ', '\n']), '');
  assert.equal(buildWhisperInitialPrompt([' DictaWhisper ', 'Mary\nJane', 'DictaWhisper', 'São Paulo']), 'DictaWhisper, Mary Jane, São Paulo');
});

// Exercise the actual Node -> Python worker/CLI protocol without loading a GPU model.
const pythonAvailable = spawnSync(config.whisper.python, ['--version'], { windowsHide: true }).status === 0;
for (const fallback of [false, true]) test(`Whisper ${fallback ? 'fallback' : 'worker'} preserves model/VAD choices without instruction prompts`, { skip: !pythonAvailable, timeout: 30_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicta-whisper-options-'));
  const originalEnv = { PYTHONPATH: process.env.PYTHONPATH, DICTA_TEST_ASR_LOG: process.env.DICTA_TEST_ASR_LOG, DICTA_TEST_ASR_FALLBACK: process.env.DICTA_TEST_ASR_FALLBACK };
  const originalTerms = config.whisper.promptTerms;
  const log = path.join(root, 'events.jsonl');
  fs.writeFileSync(path.join(root, 'faster_whisper.py'), `
import os, sys, json, time
from types import SimpleNamespace as N
def event(kind, model, options=None):
    with open(os.environ['DICTA_TEST_ASR_LOG'], 'a', encoding='utf8') as f:
        f.write(json.dumps([kind, model, '--worker' in sys.argv, options]) + '\\n')
class WhisperModel:
    def __init__(self, model, **kwargs):
        self.model = model
    def transcribe(self, audio, **kwargs):
        event('begin', self.model, kwargs)
        if '--worker' in sys.argv and os.environ.get('DICTA_TEST_ASR_FALLBACK') == '1':
            raise RuntimeError('Intentional worker failure')
        time.sleep(0.12)
        word = N(word=' Test', start=0.0, end=1.0, probability=1.0)
        segment = N(text='Test speech.', start=0.0, end=1.0, words=[word], temperature=0, avg_logprob=0, compression_ratio=1, no_speech_prob=0)
        event('end', self.model)
        return iter([segment]), N(duration=1, language='en')
`, 'utf8');
  process.env.PYTHONPATH = root;
  process.env.DICTA_TEST_ASR_LOG = log;
  process.env.DICTA_TEST_ASR_FALLBACK = fallback ? '1' : '0';
  const audio = path.join(root, 'test.wav'); fs.writeFileSync(audio, 'fixture only');
  const first = path.join(root, 'large.json'), second = path.join(root, 'turbo.json');
  fs.writeFileSync(first, JSON.stringify({ audioEnhancement: { versionId: 'saved-version' } }));
  const run = (file: string, model: 'large-v3' | 'turbo', vad: boolean) => new Promise<void>((resolve, reject) => {
    void whisperTranscribe(audio, file, payload => payload.err ? reject(payload.err) : resolve(), model, { vadFilter: vad });
  });
  try {
    config.whisper.promptTerms = [];
    await Promise.all([run(first, 'large-v3', false), run(second, 'turbo', true)]);
    const large = JSON.parse(fs.readFileSync(first, 'utf8')), turbo = JSON.parse(fs.readFileSync(second, 'utf8'));
    assert.equal(large.whisper.model, 'large-v3'); assert.equal(large.whisper.vad_filter, false);
    assert.equal(turbo.whisper.model, 'large-v3-turbo'); assert.equal(turbo.whisper.vad_filter, true);
    assert.equal(large.audioEnhancement.versionId, 'saved-version');
    const events = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.findIndex(row => row[0] === 'end' && row[1] === 'large-v3') < events.findIndex(row => row[0] === 'begin' && row[1] === 'large-v3-turbo'));
    if (fallback) assert.equal(events.filter(row => row[0] === 'end' && row[2] === false).length, 2);
    for (const row of events.filter(row => row[0] === 'begin')) assert.equal(row[3].initial_prompt, null);

    // Operator vocabulary still travels through either transport, without prose.
    config.whisper.promptTerms = ['DictaWhisper', 'São Paulo'];
    await run(path.join(root, 'vocabulary.json'), 'turbo', true);
    let latest = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').filter(line => JSON.parse(line)[0] === 'begin').at(-1)!);
    assert.equal(latest[3].initial_prompt, 'DictaWhisper, São Paulo');

    // Direct Python CLI callers must not resurrect the former default prompt.
    const direct = spawnSync(config.whisper.python, ['scripts/transcribe_faster_whisper.py', '--audio', audio, '--output', path.join(root, 'direct.json')], { windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    assert.equal(direct.status, 0, direct.stderr);
    latest = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').filter(line => JSON.parse(line)[0] === 'begin').at(-1)!);
    assert.equal(latest[3].initial_prompt, null);
  } finally {
    await stopWhisperWorker();
    config.whisper.promptTerms = originalTerms;
    for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
