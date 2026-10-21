import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readableParagraphs } from '../src/shared/readableParagraphs.ts';
import { ensurePlaybackCues } from '../src/lib/alignLib.ts';
import { applyCleanupProvenance } from '../src/lib/cleanupProvenanceLib.ts';
import { cueIndexForQuery } from '../src/lib/journalIndexLib.ts';
import { transcriptPassages, transcriptCopyText } from '../client/src/lib/entryPresentation.js';
import type { TranscriptionDocument } from '../src/types/transcription.ts';

const sentences = (count: number) => Array.from({length: count}, (_, i) => `Sentence ${i + 1} belongs here.`);
const compact = (text: string) => text.replace(/\s+/g, ' ').trim();

test('oversized readable blocks become balanced five/six-sentence paragraphs without losing words', () => {
  const text = sentences(26).join(' '), parts = readableParagraphs(text);
  assert.deepEqual(parts.map(part => part.match(/Sentence/g)?.length), [6,5,5,5,5]);
  assert.equal(compact(parts.join('\n\n')), text);
  assert.deepEqual(readableParagraphs(parts.join('\n\n')), parts, 'formatting is idempotent');
});

test('short topic paragraphs and internal line breaks survive; oversized CRLF paragraphs split', () => {
  const text = 'One thought.\nA continuation.\r\n \r\n' + sentences(12).join(' ') + '\r\n\r\nLast thought.';
  const parts = readableParagraphs(text);
  assert.equal(parts[0], 'One thought.\nA continuation.'); assert.equal(parts.at(-1), 'Last thought.');
  assert.equal(parts.length, 4);
  assert.deepEqual(readableParagraphs(sentences(6).join(' ')), [sentences(6).join(' ')]);
  assert.deepEqual(readableParagraphs(''), []);
  assert.deepEqual(readableParagraphs('A thought with no final punctuation'), ['A thought with no final punctuation']);
  assert.deepEqual(readableParagraphs(sentences(7).join(' ')).map(part => part.match(/Sentence/g)?.length), [4,3]);
});

test('paragraph boundaries do not detach names, decimal values or quote attributions', () => {
  const sentence = 'Dr. Lee paid $3.50. "Ready?" she asked. I said yes.';
  const text = `${sentence} ${sentence} ${sentence}`;
  const parts = readableParagraphs(text);
  assert.equal(compact(parts.join(' ')), text);
  assert.equal(parts.length, 2);
  assert.ok(parts.every(part => !part.endsWith('Dr.') && !part.startsWith('Lee') && !part.startsWith('she asked')));
});

test('new cleanup saves normalized text consistently in provenance, preserving the prior version', () => {
  const text = sentences(26).join(' ');
  const json: TranscriptionDocument = {text:'Original raw speech.', cleanedTranscription:'Previous readable text.'};
  applyCleanupProvenance(json, {text, promptVersion:4});
  assert.equal(json.cleanedTranscription, readableParagraphs(text).join('\n\n'));
  assert.equal(json.cleanup?.text, json.cleanedTranscription);
  assert.equal(json.cleanupHistory?.[0].text, 'Previous readable text.');
  assert.equal(json.text, 'Original raw speech.');
});

test('legacy readable entries get paragraph cues and search landing from the same boundaries', () => {
  const rows = sentences(26); rows[22] = 'The needle belongs here.';
  const text = rows.join(' '), tokens = text.split(' ');
  const json: TranscriptionDocument = {text, cleanedTranscription:text, segments:[{start:0,end:tokens.length,text,words:tokens.map((word,i)=>({word,start:i,end:i+1}))}],playbackCues:[{text,start:0,end:tokens.length}],playbackCuesSource:'words'};
  assert.equal(ensurePlaybackCues(json), true);
  const parts = transcriptPassages(json);
  assert.equal(parts.length, 5);
  assert.deepEqual(parts.map(part=>part.text), readableParagraphs(text));
  assert.deepEqual(parts.map(part=>part.start), [0,24,44,64,84]);
  assert.equal(cueIndexForQuery(text, 'needle'), 4);
  assert.match(parts[4].text, /needle/);
  assert.equal(transcriptCopyText(json), readableParagraphs(text).join('\n\n'));
  assert.equal(json.cleanedTranscription, text, 'opening an older entry does not rewrite its model output');
  assert.equal(ensurePlaybackCues(json), false);
});

test('untimed fallback and old long cues are readable without fabricated timestamps; Original stays exact', () => {
  const text = sentences(26).join(' '), segments = [{text,start:10,end:100}];
  const json = {text,cleanedTranscription:text,segments};
  assert.equal(transcriptPassages(json).length, 5);
  assert.ok(transcriptPassages(json).every(row=>row.start===null && row.end===null));
  const oldCues = transcriptPassages({...json, playbackCues:segments});
  assert.equal(oldCues[0].start, 10); assert.equal(oldCues[0].end, null);
  assert.ok(oldCues.slice(1).every(row=>row.start===null && row.end===null));
  assert.equal(transcriptCopyText(json,true), text);
  assert.deepEqual(transcriptPassages(json,true), segments);
});
