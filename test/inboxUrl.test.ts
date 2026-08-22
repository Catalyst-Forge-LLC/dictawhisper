import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInboxSearch, emptyInboxUrl, parseInboxUrl } from '../src/lib/inboxUrl.ts';

test('round-trips q, tags, year, and file', () => {
  const state = {
    ...emptyInboxUrl(),
    q: 'sangria',
    tags: ['Kristen'],
    year: '2013',
    file: 'C:\\notes\\2013\\07\\a.json',
  };
  const parsed = parseInboxUrl(buildInboxSearch(state));
  assert.equal(parsed.q, 'sangria');
  assert.deepEqual(parsed.tags, ['Kristen']);
  assert.equal(parsed.year, '2013');
  assert.equal(parsed.file, state.file);
});

test('month requires a year and pads to two digits', () => {
  const parsed = parseInboxUrl('month=7&year=2015');
  assert.equal(parsed.month, '07');
  assert.equal(parseInboxUrl('month=7').month, '');
});

test('clear-search shape keeps year and tags', () => {
  const kept = parseInboxUrl(buildInboxSearch({
    ...emptyInboxUrl(),
    tags: ['kristen'],
    year: '2011',
  }));
  assert.equal(kept.q, '');
  assert.equal(kept.year, '2011');
  assert.deepEqual(kept.tags, ['kristen']);
});
