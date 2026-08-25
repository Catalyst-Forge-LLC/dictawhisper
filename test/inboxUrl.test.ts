import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInboxSearch, emptyInboxUrl, inboxPath, parseCueHash, parseInboxUrl, tightenFilenameHits } from '../src/lib/inboxUrl.ts';

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

test('cue hash is parsed and written next to the open file', () => {
  assert.equal(parseCueHash('#cue-3'), 3);
  assert.equal(parseCueHash('cue-0'), 0);
  assert.equal(parseCueHash('#nope'), null);
  const path = inboxPath({
    ...emptyInboxUrl(),
    q: 'sangria',
    file: 'C:/notes/a.json',
    cue: 2,
  });
  assert.match(path, /q=sangria/);
  assert.match(path, /#cue-2$/);
});

test('filename hits drop hybrid neighbors that do not match the stamp', () => {
  const hits = tightenFilenameHits('2016-06-01_12-06-25', [
    { basename: '2016-06-01_12-06-25.json', jsonFile: 'C:/notes/2016/06/2016-06-01_12-06-25.json' },
    { basename: '2025-06-01_17-40-41My recording 643.json', jsonFile: 'C:/notes/2025/06/x.json' },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].basename, '2016-06-01_12-06-25.json');
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
