import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensurePlaybackCues, type PlaybackCue, type WhisperSegment } from '../src/lib/alignLib.ts';

function document() {
  return {
    cleanedTranscription: 'I tried it. It failed.\n\nI like the blue one.',
    segments: [
      { start: 0, end: 2, text: 'um I tried it', words: [{word:'um',start:0,end:.1},{word:'I',start:.2,end:.3},{word:'tried',start:.4,end:1},{word:'it',start:1,end:2}] },
      { start: 3, end: 4, text: 'it failed', words: [{word:'it',start:3,end:3.2},{word:'failed',start:3.2,end:4}] },
      { start: 5, end: 7, text: 'I like the blue one', words: [{word:'I',start:5,end:5.1},{word:'like',start:5.1,end:5.3},{word:'the',start:5.3,end:5.5},{word:'blue',start:5.5,end:6},{word:'one',start:6,end:7}] },
    ] as WhisperSegment[],
    playbackCues: undefined as PlaybackCue[] | undefined,
    playbackCuesSource: undefined as string | undefined,
  };
}

test('readable paragraphs span raw fragments without changing the original or inventing words', () => {
  const json = document(), raw = structuredClone(json.segments);
  assert.equal(ensurePlaybackCues(json), true);
  assert.deepEqual(json.playbackCues, [
    {text:'I tried it. It failed.',start:.4,end:4},
    {text:'I like the blue one.',start:5.3,end:7},
  ]);
  assert.deepEqual(json.segments, raw);
  assert.equal(ensurePlaybackCues(json), false, 'unchanged cues do not rewrite the sidecar');
});

test('reclean with the same number of paragraphs replaces stale cue text and punctuation', () => {
  const json = document(); ensurePlaybackCues(json);
  json.cleanedTranscription = 'I tried it; it failed.\n\nI like the blue one!';
  assert.equal(ensurePlaybackCues(json), true);
  assert.deepEqual(json.playbackCues?.map(cue => cue.text), json.cleanedTranscription.split('\n\n'));
  assert.equal(ensurePlaybackCues(json), false);
});

test('changed word timestamps regenerate cues even if cleaned text and paragraph count match', () => {
  const json = document(); ensurePlaybackCues(json);
  for (const segment of json.segments) for (const word of segment.words!) { word.start += 10; word.end += 10; }
  assert.equal(ensurePlaybackCues(json), true);
  assert.equal(json.playbackCues?.[0].start, 10.4);
  assert.equal(json.playbackCues?.[1].end, 17);
});

test('missing word timing removes old cues and leaves readable text available untimed', () => {
  const json = document(); ensurePlaybackCues(json);
  json.segments = [];
  assert.equal(ensurePlaybackCues(json), true);
  assert.equal(json.playbackCues, undefined); assert.equal(json.playbackCuesSource, undefined);
  assert.ok(json.cleanedTranscription); assert.equal(ensurePlaybackCues(json), false);
});
