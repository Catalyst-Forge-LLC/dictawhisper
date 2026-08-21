import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { planFile, parseEmbeddedUnderscoreDate } from '../scripts/inbox-organize.mjs';

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

test('parses call-recording underscore clocks', () => {
  const parsed = parseEmbeddedUnderscoreDate('Bold Patent Call_2019_12_03_18_59_40_in.mp3');
  assert.ok(parsed);
  assert.equal(parsed.parsed.year, '2019');
  assert.equal(parsed.parsed.month, '12');
});
