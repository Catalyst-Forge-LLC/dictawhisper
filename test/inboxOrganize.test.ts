import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseFilenameDate } from '../../mediatuna/lib/filename-dates.js';
import { planFile, parseEmbeddedUnderscoreDate } from '../scripts/inbox-organize.mjs';
import { isPhoneDumpName, stampedNameFromMtime } from '../scripts/inbox-stamp-mtime.mjs';
import { plannedMtime } from '../scripts/inbox-fix-mtime.mjs';

const inbox = 'C:\\Users\\acmegeek\\VoiceNotes\\__inbox';

test('files YY-MM-DD names into __inbox/YYYY/MM', () => {
  const plan = planFile(path.join(inbox, '___INBOX', '10-09-25-12-34-56-Recording.mp3'), inbox);
  assert.equal(plan.action, 'move');
  assert.equal(plan.year, '2010');
  assert.equal(plan.month, '09');
  assert.ok(plan.dest.replace(/\\/g, '/').includes('/__inbox/2010/09/'));
  assert.ok(plan.dest.includes('2010-09-25'));
});

test('uses parent YYYY-MM when the basename has no date', () => {
  const plan = planFile(path.join(inbox, '2009-02', 'Recording10.mp3'), inbox);
  assert.equal(plan.action, 'move');
  assert.equal(plan.year, '2009');
  assert.equal(plan.month, '02');
  assert.match(plan.dest.replace(/\\/g, '/'), /__inbox\/2009\/02\/Recording10\.mp3$/);
});

test('leaves undated files in __inbox/_unfiled', () => {
  const plan = planFile(path.join(inbox, 'phone', 'mystery.mp3'), inbox);
  assert.equal(plan.action, 'unfiled');
  assert.match(plan.dest.replace(/\\/g, '/'), /__inbox\/_unfiled\/mystery\.mp3$/);
});

test('does not rename files already sitting in _unfiled', () => {
  const src = path.join(inbox, '_unfiled', 'VOICE_057.mp3');
  const plan = planFile(src, inbox);
  assert.equal(plan.action, 'already');
  assert.equal(path.resolve(plan.dest), path.resolve(src));
});

test('parses call-recording underscore clocks', () => {
  const parsed = parseEmbeddedUnderscoreDate('Bold Patent Call_2019_12_03_18_59_40_in.mp3');
  assert.ok(parsed);
  assert.equal(parsed.parsed.year, '2019');
  assert.equal(parsed.parsed.month, '12');
});

test('files Sam Douglas tape labels into YYYY/MM from the name date', () => {
  const parsed = parseEmbeddedUnderscoreDate('001_A_001_Sam Douglas_2007_08_07.mp3');
  assert.ok(parsed);
  assert.equal(parsed.parsed.year, '2007');
  assert.equal(parsed.parsed.month, '08');
  assert.equal(parsed.parsed.hasTime, false);
  const plan = planFile(path.join(inbox, '_unfiled', '001_A_001_Sam Douglas_2007_08_07.mp3'), inbox);
  assert.equal(plan.action, 'move');
  assert.equal(plan.year, '2007');
  assert.equal(plan.month, '08');
  assert.match(path.basename(plan.dest), /^2007-08-07_001_A_001_Sam Douglas\.mp3$/);
});

test('stamps phone dumps with MTIME_ from local mtime', () => {
  assert.equal(isPhoneDumpName('Record000.mp3'), true);
  assert.equal(isPhoneDumpName('Record017-3.qcp'), true);
  assert.equal(isPhoneDumpName('Video000.3g2'), true);
  assert.equal(isPhoneDumpName('VOICE_057.mp3'), false);
  const name = stampedNameFromMtime('Record000.mp3', new Date(2006, 2, 21, 12, 29, 14));
  assert.equal(name, 'MTIME_2006-03-21_12-29-14_Record000.mp3');
});

test('mtime fix treats a Z stamp as UTC', () => {
  const parsed = parseFilenameDate('2011-07-10_10-56-21Z_Memo.m4a');
  assert.equal(parsed.hasZ, true);
  const next = plannedMtime(parsed, new Date(2015, 7, 23, 17, 42, 0));
  assert.equal(next.toISOString(), '2011-07-10T10:56:21.000Z');
});

test('mtime fix keeps the clock and changes only the calendar date', () => {
  const parsed = parseEmbeddedUnderscoreDate('001_A_001_Sam Douglas_2007_08_07.mp3');
  const next = plannedMtime(parsed, new Date(2015, 7, 23, 17, 42, 17));
  assert.equal(next.getFullYear(), 2007);
  assert.equal(next.getMonth(), 7);
  assert.equal(next.getDate(), 7);
  assert.equal(next.getHours(), 17);
  assert.equal(next.getMinutes(), 42);
});

test('files MTIME_ names into __inbox/YYYY/MM', () => {
  const plan = planFile(
    path.join(inbox, '_unfiled', 'MTIME_2006-03-21_12-29-14_Record000.mp3'),
    inbox,
  );
  assert.equal(plan.action, 'move');
  assert.equal(plan.year, '2006');
  assert.equal(plan.month, '03');
  assert.equal(plan.dateSource, 'filename:mtime');
});
