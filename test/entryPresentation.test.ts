import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryPresentation, transcriptPassages, transcriptCopyText, activeMayDoCount, markEntryMatch, copyTranscriptText, selectedPassageText } from '../client/src/lib/entryPresentation.js';
import { preserveHumanEdits } from '../src/lib/humanEditsLib.ts';

const entry = (name: string, json = {}) => ({ jsonFile: `C:/journal/${name}.json`, transcriptionJson: json });
test('titles preserve meaningful labels, user choice, date precision, and generic sequences', () => {
  assert.equal(entryPresentation(entry('2026-10-01 21-16-02My recording 80')).title, 'Recording on Oct 1, 2026');
  assert.match(entryPresentation(entry('2026-10-01 21-16-02My recording 80')).dateLabel, /9:16 PM/);
  assert.equal(entryPresentation(entry('2010-12-16_Recording')).title, 'Recording on Dec 16, 2010');
  const month = entryPresentation(entry('2009-03_Two Bit Tips'));
  assert.equal(month.title, 'Two Bit Tips'); assert.equal(month.dateLabel, 'March 2009'); assert.equal(month.precision, 'month');
  assert.equal(entryPresentation(entry('2026-10-01_My recording 9', { displayTitle: ' Kitchen repair ' })).title, 'Kitchen repair');
  assert.equal(entryPresentation(entry('2026-10-01_Project 123')).title, 'Project 123');
});
test('uncertain or invalid prefixes preserve the basename; processing elapsed is never audio duration', () => {
  for (const name of ['2026-02-30_Recording', '2026-13_Recording', '2026-10-01 25-16-02Recording', '2026-10-01-99_Recording']) assert.equal(entryPresentation(entry(name)).title, name);
  const value = entryPresentation(entry('Meeting', { elapsed: '123s' }));
  assert.equal(value.dateLabel, ''); assert.equal(value.title, 'Meeting');
});
test('original text and untimed fallback remain readable without pretending to have timestamps', () => {
  assert.deepEqual(transcriptPassages({ text: 'First.\n\nSecond.' }), [{ text: 'First.', start: null, end: null }, { text: 'Second.', start: null, end: null }]);
  assert.deepEqual(transcriptPassages({ text: 'Raw', cleanedTranscription: 'Readable' }, true), [{ text: 'Raw', start: null, end: null }]);
  assert.equal(transcriptPassages({ cleanedTranscription: 'Readable' })[0].start, null);
  assert.equal(activeMayDoCount({ mayDos: ['suggested','selected','done','dismissed'].map(status => ({ status })) }), 2);
});
test('Find highlighting is literal and escapes transcript/query markup', () => {
  assert.equal(markEntryMatch('<script>x</script>', 'script'), '&lt;<mark>script</mark>&gt;x&lt;/<mark>script</mark>&gt;');
  assert.equal(markEntryMatch('One [a]. Two [a].', '[a]'), 'One <mark>[a]</mark>. Two <mark>[a]</mark>.');
});
test('copy handles unsupported and rejected clipboards with an actionable manual fallback', async () => {
  let copied = '';
  assert.equal((await copyTranscriptText('Exact original text.', { writeText: async (text: string) => copied = text })).error, '');
  assert.equal(copied, 'Exact original text.');
  for (const clipboard of [undefined, { writeText: async () => { throw new Error('denied'); } }]) assert.match((await copyTranscriptText('Exact original text.', clipboard)).error, /Select transcript text and copy manually/);
});
test('cleanup restores current human title, star and edited tags without replacing new generated tags otherwise', () => {
  const output: any = { tags: ['generated'] };
  preserveHumanEdits(output, { tags: ['old'] }, { tags: ['human'], displayTitle: 'My title', starred: true });
  assert.deepEqual(output, { tags: ['human'], displayTitle: 'My title', starred: true, tagsEditedAt: undefined });
  const plain = { tags: ['generated'] };
  preserveHumanEdits(plain, { tags: ['old'] }, { tags: ['old'] }); assert.deepEqual(plain.tags, ['old', 'generated']);
  preserveHumanEdits(plain, { tags: ['old'] }, { tags: ['old'], tagsEditedAt: 'now' }); assert.deepEqual(plain.tags, ['old']);
});

test('multi-passage copy preserves transcript order, paragraph breaks, and plain text without timestamps', () => {
  const passages = [{text:'  First <literal>.  ',start:0},{text:'Not selected.',start:5},{text:'Third.\nSecond line.',start:10}];
  assert.equal(selectedPassageText(passages,[2,0,2]),'First <literal>.\n\nThird.\nSecond line.');
  assert.equal(selectedPassageText(passages,[]),'');
  assert.equal(selectedPassageText(passages,[99,-1]),'');
  assert.equal(selectedPassageText([{text:'  '},{text:'Last.'}],[0,1]),'Last.');
});

test('full original copy preserves displayed segments even when Whisper text is flattened', async () => {
  const json = {text:'First original passage. Second <literal> passage. Last line.', cleanedTranscription:'Different readable text.',
    segments:[{text:' First original passage. ',start:0,end:5},{text:'  ',start:5,end:6},{text:'Second <literal> passage.\nLast line.',start:6,end:12}]};
  let clipboard = '';
  await copyTranscriptText(transcriptCopyText(json, true), {writeText:async (text: string) => {clipboard = text;}});
  assert.equal(clipboard, 'First original passage.\n\nSecond <literal> passage.\nLast line.');
});

test('full readable copy follows displayed cues and preserves internal line breaks', () => {
  const json = {text:'Original text.', cleanedTranscription:'Flattened readable text.', segments:[{text:'Original segment.'}],
    playbackCues:[{text:'First readable paragraph.',start:0},{text:'Second paragraph.\nAnother line.',start:10}]};
  assert.equal(transcriptCopyText(json), 'First readable paragraph.\n\nSecond paragraph.\nAnother line.');
  assert.equal(transcriptCopyText(json, true), 'Original segment.');
});

test('full copy keeps legacy text when passages are missing or empty', () => {
  assert.equal(transcriptCopyText({text:'First.\r\n\r\nSecond.'},true),'First.\r\n\r\nSecond.');
  assert.equal(transcriptCopyText({cleanedTranscription:'First.\n\nSecond.'}),'First.\n\nSecond.');
  assert.equal(transcriptCopyText({text:'Unsegmented original.'}),'Unsegmented original.');
  assert.equal(transcriptCopyText({text:'Legacy fallback.',segments:[{text:' '}]},true),'Legacy fallback.');
  assert.equal(transcriptCopyText(undefined),'');
});
