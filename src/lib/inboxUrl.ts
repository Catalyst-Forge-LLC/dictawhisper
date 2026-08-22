export type InboxSort = 'recent' | 'oldest' | 'relevance' | '';
export type InboxMode = 'lex' | 'hybrid' | '';

export type InboxUrlState = {
  q: string;
  tags: string[];
  year: string;
  month: string;
  since: string;
  until: string;
  sort: InboxSort;
  mode: InboxMode;
  unreadable: boolean;
  starred: boolean;
  file: string;
};

const SORTS = new Set(['recent', 'oldest', 'relevance']);
const MODES = new Set(['lex', 'hybrid']);

export function emptyInboxUrl(): InboxUrlState {
  return {
    q: '',
    tags: [],
    year: '',
    month: '',
    since: '',
    until: '',
    sort: '',
    mode: '',
    unreadable: false,
    starred: false,
    file: '',
  };
}

export function parseInboxUrl(search: string | URLSearchParams): InboxUrlState {
  const params =
    typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  const sortRaw = params.get('sort') || '';
  const modeRaw = params.get('mode') || '';
  const year = (params.get('year') || '').trim();
  const monthRaw = (params.get('month') || '').trim();
  const month = /^\d{1,2}$/.test(monthRaw) ? monthRaw.padStart(2, '0') : '';
  return {
    q: params.get('q') || '',
    tags: params.getAll('tag').map((tag) => tag.trim()).filter(Boolean),
    year: /^\d{4}$/.test(year) ? year : '',
    month: year && month && Number(month) >= 1 && Number(month) <= 12 ? month : '',
    since: (params.get('since') || '').trim(),
    until: (params.get('until') || '').trim(),
    sort: SORTS.has(sortRaw) ? (sortRaw as InboxSort) : '',
    mode: MODES.has(modeRaw) ? (modeRaw as InboxMode) : '',
    unreadable: params.get('unreadable') === '1',
    starred: params.get('starred') === '1',
    file: params.get('file') || '',
  };
}

export function buildInboxSearch(state: InboxUrlState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  for (const tag of state.tags) {
    if (tag.trim()) params.append('tag', tag.trim());
  }
  if (state.year) params.set('year', state.year);
  if (state.year && state.month) params.set('month', state.month);
  if (state.since) params.set('since', state.since);
  if (state.until) params.set('until', state.until);
  if (state.sort) params.set('sort', state.sort);
  if (state.mode) params.set('mode', state.mode);
  if (state.unreadable) params.set('unreadable', '1');
  if (state.starred) params.set('starred', '1');
  if (state.file) params.set('file', state.file);
  return params.toString();
}

export function inboxPath(state: InboxUrlState): string {
  const qs = buildInboxSearch(state);
  return qs ? `/?${qs}` : '/';
}
