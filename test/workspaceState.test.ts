import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyInboxUrl } from '../src/lib/inboxUrl.ts';
import { adjacentEntry, anchorIndex, chooseCalendarDate, chooseCustomDate, clearOptionalFilters,
  createWorkspaceSession, dateScope, scopeOf, workspaceKey } from '../client/src/lib/workspaceState.js';
import { parseMayDoFilter, parseMayDoStatusSet } from '../src/lib/mayDoLib.ts';

test('named views own defaults, clear filters retains query and the named view', () => {
  const state = { ...emptyInboxUrl(), view: 'maydos', q: 'repair', tags: ['home'], mayDoStatuses: ['done'], starred: true };
  assert.deepEqual(scopeOf(state).mayDos, ['done']);
  const cleared = clearOptionalFilters(state);
  assert.equal(cleared.view, 'maydos');
  assert.equal(cleared.q, 'repair');
  assert.deepEqual(scopeOf(cleared).mayDos, ['suggested', 'selected']);
  assert.equal(scopeOf({ ...cleared, view: 'starred' }).starred, true);
  assert.equal(scopeOf(emptyInboxUrl()).folder, 'active');
  assert.equal(scopeOf({ ...cleared, view: 'attention' }).attention, true);
  assert.equal(scopeOf({ ...cleared, mayDos: 'any' }).mayDos, 'any');
});

test('choosing either kind of date removes the other, including one-sided ranges', () => {
  assert.deepEqual(chooseCalendarDate('2010', '07'), { year: '2010', month: '07', since: '', until: '' });
  assert.deepEqual(chooseCustomDate('', '2025-01-01'), { year: '', month: '', since: '', until: '2025-01-01' });
  assert.equal(dateScope({ year: '2010', month: '07', since: '2025-01-01' }).year, '');
  assert.equal(dateScope({ since: '2025-02-30' }).since, '');
});

test('session anchors ignore selection and survive grid regrouping; readers are per entry', () => {
  const base = emptyInboxUrl();
  assert.equal(workspaceKey(base), workspaceKey({ ...base, file: 'a', cue: 3 }));
  assert.notEqual(workspaceKey(base), workspaceKey({ ...base, q: 'older' }));
  const session = createWorkspaceSession();
  session.anchors.set(workspaceKey(base), { key: 'b', offset: 23 });
  session.readers.set('b', { tab: 'tags', scroll: 301, time: 45 });
  const restored = createWorkspaceSession(session.serialize());
  assert.equal(restored.anchors.get(workspaceKey(base)).offset, 23);
  assert.equal(anchorIndex([[{ jsonFile: 'a' }, { jsonFile: 'b' }]], 'b'), 0);
  assert.equal(anchorIndex([[{ jsonFile: 'a' }], [{ jsonFile: 'b' }]], 'b'), 1);
  assert.deepEqual(restored.reader('b'), { tab: 'tags', scroll: 301, time: 45 });
  assert.deepEqual(restored.reader('a'), { tab: 'transcript', scroll: 0, time: 0 });
});

test('outside-results Next uses the first current result and boundaries stay explicit', () => {
  const items = [{ jsonFile: 'a' }, { jsonFile: 'b' }];
  assert.equal(adjacentEntry(items, 'outside', 1), 'a');
  assert.equal(adjacentEntry(items, 'outside', -1), '');
  assert.equal(adjacentEntry(items, 'b', 1), '');
});

test('server status-set validation preserves single-status callers and rejects broadening', () => {
  assert.equal(parseMayDoFilter('done'), 'done');
  assert.equal(parseMayDoFilter('any'), 'any');
  assert.deepEqual(parseMayDoStatusSet(['selected', 'suggested', 'selected']), ['suggested', 'selected']);
  assert.deepEqual(parseMayDoStatusSet('done'), ['done']);
  assert.equal(parseMayDoStatusSet(undefined), undefined);
  assert.throws(() => parseMayDoStatusSet(['done', 'typo']), /valid MayDo statuses/);
  assert.throws(() => parseMayDoStatusSet({ status: 'done' }), /valid MayDo statuses/);
});
