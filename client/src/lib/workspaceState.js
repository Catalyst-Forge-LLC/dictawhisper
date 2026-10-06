import { MAY_DO_STATUSES } from '../../../src/shared/mayDoState.ts';
export { MAY_DO_STATUSES };
export const LIBRARY_VIEWS = ['library', 'starred', 'maydos', 'attention'];

export function normalizedView(view) {
  return LIBRARY_VIEWS.includes(view) ? view : 'library';
}

export function viewDefaults(view) {
  return { starred: view === 'starred', mayDoStatuses: view === 'maydos' ? ['suggested', 'selected'] : [] };
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

// A custom range takes precedence when resolving contradictory old/copied links.
export function dateScope(state) {
  const since = validDate(state.since);
  const until = validDate(state.until);
  return since || until ? { year: '', month: '', since, until } : {
    year: state.year || '', month: state.year ? state.month || '' : '', since: '', until: '',
  };
}

export function chooseCalendarDate(year, month = '') {
  return { year, month: year ? month : '', since: '', until: '' };
}

export function chooseCustomDate(since, until) {
  return { year: '', month: '', since, until };
}

export function scopeOf(state) {
  const defaults = viewDefaults(state.view);
  const statuses = MAY_DO_STATUSES.filter(status => (state.mayDoStatuses || []).includes(status));
  return {
    ...dateScope(state),
    folder: state.folder || (state.view === 'attention' ? '' : 'active'),
    attention: state.view === 'attention',
    starred: Boolean(state.starred || defaults.starred),
    mayDos: state.mayDos === 'any' ? 'any' : statuses.length ? statuses :
      MAY_DO_STATUSES.includes(state.mayDos) ? [state.mayDos] : defaults.mayDoStatuses,
  };
}

export function clearOptionalFilters(state) {
  return { ...state, tags: [], mayDos: '', mayDoStatuses: [], year: '', month: '', since: '', until: '',
    folder: '', starred: false, unreadable: false };
}

export function workspaceKey(state) {
  const scope = scopeOf(state);
  return JSON.stringify([normalizedView(state.view), state.q.trim(), [...new Set(state.tags)].sort(), scope,
    state.sort || (state.q.trim() ? 'relevance' : 'recent'), state.mode || '', Boolean(state.unreadable)]);
}

export function adjacentEntry(items, selectedFile, direction) {
  const index = items.findIndex(item => item.jsonFile === selectedFile);
  if (index < 0) return direction > 0 ? items[0]?.jsonFile || '' : '';
  return items[index + direction]?.jsonFile || '';
}

// Only entry identity and an offset within its row survive changes in column count.
export function anchorIndex(rows, key) {
  return rows.findIndex(row => row.some(item => item.jsonFile === key));
}

export function createWorkspaceSession(saved = {}) {
  const anchors = new Map(saved.anchors || []);
  const readers = new Map(saved.readers || []);
  return {
    anchors, readers,
    reader(file) { return readers.get(file) || { tab: 'transcript', scroll: 0, time: 0 }; },
    serialize() { return { version: 1, anchors: [...anchors].slice(-100), readers: [...readers].slice(-100) }; },
  };
}
