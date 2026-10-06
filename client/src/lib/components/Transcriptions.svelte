<script>
  import { onMount, onDestroy, tick, createEventDispatcher } from 'svelte';
  import { inboxPath, isFilenameQuery, parseCueHash, parseInboxUrl, tightenFilenameHits } from '../inboxUrl.js';
  import { adjacentEntry, chooseCalendarDate, chooseCustomDate, clearOptionalFilters, createWorkspaceSession, MAY_DO_STATUSES, scopeOf, workspaceKey } from '../workspaceState.js';
  import { displayName } from '../markPreview.js';
  import NoteList from './NoteList.svelte';
  import OrganizationDialog from './OrganizationDialog.svelte';
  let organizationFile='', organizationMode='date', trashUndo=null, trashTimer, trashBusy=false;
  const removalReceipts=new Map();
  onDestroy(()=>{clearTimeout(trashTimer);clearTimeout(tagTimer);});
  let tagUndo=null, tagTimer, tagBusy=false;
  import NoteCard from './NoteCard.svelte';
  import LibraryRail from './LibraryRail.svelte';
  import EntryListPane from './EntryListPane.svelte';
  import PendingEntry from './PendingEntry.svelte';
  import EntryReader from './EntryReader.svelte';
  import { entryPresentation } from '../entryPresentation.js';

  const dispatch = createEventDispatcher();
  export let mayDoJob = null;
  export let transcriptions = [];
  export let socket;
  export let connected = false;
  export let activityItems = [];
  export let activityReady = false;
  export let entryIntent = null;
  let handledIntent=0, reconcilingPending=false, reconciledVersion='', pendingItem=null;
  export let noteFilter = 'all';

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  let selectedFile = '';
  let noteCache = {};
  let noteList;
  let entryScroll;
  let searchInput;
  let detailHeading;
  let filterButton;
  let expandedYears = {};
  let restoringReader = false;
  let readerState = { tab: 'transcript', scroll: 0, time: 0 };
  let session = createWorkspaceSession();
  let returnFocusFile = '';
  let committedKey = '';
  let requestBusy = false;
  let searchController;
  let browseController;
  let historyReplay = false;
  let navigationRequest = 0;
  let browseSort = '';
  let wasSearching = false;
  let compactMedia;
  let pendingAnchor = null;
  let showRaw = {};
  let mayDoFilter = '';
  let mayDoStatuses = [];
  let folderFilter = '';
  let detailLoading = false;
  let detailError = '';
  let detailRequest = 0;
  let detailScroll;
  let libraryView = 'library';
  export let navigationOpen = false;
  let filtersOpen = false;
  let tagSearch = '';
  let browseRequest = 0;
  let filterRequest = 0;
  let browseBusy = false;
  let selectedTags = [];
  let showSingletons = false;
  let showAllFrequent = false;
  let searchQuery = '';
  let filterYear = '';
  let filterMonth = '';
  let since = '';
  let until = '';
  let sortChoice = '';
  let modeChoice = '';
  let starredOnly = false;
  let inboxError = '';
  let indexReady = false;
  let indexing = false;
  let pagedIndex = false;
  let remoteHits = null;
  let entryPage = null;
  let pageParams = '';
  let moreBusy = false;
  let cursorExpired = false;
  let moreError = '';
  let moreController;
  let pagingComplete;
  let moreRequest = 0;
  let landCue = null;
  let searchTimer;
  let lastSearchKey = '';
  let lastBrowseKey = '';
  let tagRows = [];
  let yearCounts = [];
  let noteBusy = {};
  let journalMeta = null;
  let applyingUrl = false;
  const TAG_CLOUD_CAP = 12;

  function folderOf(jsonFile) {
    const norm = String(jsonFile || '').replace(/\\/g, '/');
    if (/\/_holding(?:\/|$)/i.test(norm)) return { year: null, month: null, key: 'holding' };
    if (/\/_unfiled(?:\/|$)/i.test(norm)) return { year: null, month: null, key: 'unfiled' };
    const inPath = norm.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
    if (inPath) return { year: inPath[1], month: inPath[2], key: `${inPath[1]}-${inPath[2]}` };
    const base = norm.split('/').pop() || '';
    const inName = base.match(/^(\d{4})-(\d{2})-\d{2}/);
    if (inName) return { year: inName[1], month: inName[2], key: `${inName[1]}-${inName[2]}` };
    return { year: null, month: null, key: 'other' };
  }

  function groupLabel(group) {
    if (group.key === 'holding') return 'Holding';
    if (group.key === 'unfiled') return 'Unfiled';
    if (group.key === 'other') return 'Other';
    const monthName = MONTHS[Number(group.month) - 1] || group.month;
    return `${monthName} ${group.year}`;
  }

  function tagsOf(item) {
    const tags = item.transcriptionJson?.tags;
    return Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  }

  function groupTranscriptions(list) {
    const map = new Map();
    for (const item of list) {
      const folder = folderOf(item.jsonFile);
      if (!map.has(folder.key)) map.set(folder.key, { ...folder, items: [] });
      map.get(folder.key).items.push(item);
    }
    for (const group of map.values()) {
      group.items.sort((a, b) => displayName(b.jsonFile).localeCompare(displayName(a.jsonFile)));
    }
    const specialKeys = new Set(['holding', 'unfiled', 'other']);
    const dated = [...map.values()].filter((group) => !specialKeys.has(group.key));
    dated.sort((a, b) => b.key.localeCompare(a.key));
    const special = ['holding', 'unfiled', 'other'].map((key) => map.get(key)).filter(Boolean);
    return [...special.filter((group) => group.key !== 'other'), ...dated, ...special.filter((group) => group.key === 'other')];
  }

  function buildTagCloud(list) {
    const counts = new Map();
    for (const item of list) {
      for (const tag of tagsOf(item)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({
        tag,
        count,
        size: `${0.8 + (count / max) * 0.7}rem`,
      }));
  }

  function toggleTag(tag) {
    selectedTags = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `request failed (${response.status})`); error.code = data.code; throw error; }
    return data;
  }

  function noteFromHit(hit) {
    if (hit?.transcriptionJson && !hit.transcriptionJson._partial) return hit;
    const json = hit.transcriptionJson || {};
    return {
      jsonFile: hit.jsonFile,
      basename: hit.basename || displayName(hit.jsonFile),
      day: hit.day || json.day || '',
      snippet: hit.snippet || json.snippet || '',
      cue: hit.cue ?? json.cue ?? null,
      transcriptionJson: {
        entryId: hit.entryId || json.entryId,
        displayTitle: hit.displayTitle || json.displayTitle,
        tags: hit.tags || json.tags || [],
        preview: hit.preview || json.preview || '',
        hasCleaned: hit.hasCleaned ?? json.hasCleaned,
        audioError: hit.audioError || json.audioError || null,
        mayDoActiveCount: hit.mayDoActiveCount ?? json.mayDoActiveCount ?? 0,
        mayDoCount: hit.mayDoCount ?? json.mayDoCount ?? json.mayDos?.length ?? 0,
        mayDoTotalCount: hit.mayDoTotalCount ?? json.mayDoTotalCount ?? hit.mayDoCount ?? json.mayDoCount ?? 0,
        mayDoStatusCounts: hit.mayDoStatusCounts ?? json.mayDoStatusCounts,
        mayDoStatuses: hit.mayDoStatuses || json.mayDoStatuses || [],
        starred: Boolean(hit.starred ?? json.starred),
        _partial: json._partial !== false,
        ...json,
        tags: hit.tags || json.tags || [],
        starred: Boolean(hit.starred ?? json.starred),
      },
    };
  }

  function mergeNotes(notes, { replace = false } = {}) {
    const incoming = (notes || []).map(noteFromHit).map(note => {
      const cached = noteCache[note.jsonFile];
      return cached ? { ...note, ...cached, day: note.day || cached.day } : note;
    });
    if (replace) {
      transcriptions = incoming;
      return;
    }
    const map = new Map(transcriptions.map((note) => [note.jsonFile, note]));
    for (const note of incoming) {
      const current = map.get(note.jsonFile);
      if (current?.transcriptionJson && !current.transcriptionJson._partial && note.transcriptionJson?._partial) {
        continue;
      }
      map.set(note.jsonFile, note);
    }
    transcriptions = [...map.values()];
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `request failed (${response.status})`); error.code = data.code; throw error; }
    return data;
  }

  async function loadMeta() {
    try {
      const [years, tags, stats] = await Promise.all([
        fetchJson('/notes/years'),
        fetchJson('/notes/tags?includeSingletons=1'),
        fetchJson('/notes/stats'),
      ]);
      yearCounts = years.years || [];
      tagRows = tags.tags || [];
      journalMeta = stats;
    } catch {
      if (!yearCounts.length) yearCounts = [];
      if (!tagRows.length) tagRows = buildTagCloud(transcriptions).map(({ tag, count }) => ({ tag, count }));
    }
  }

  function isHitMode() {
    return Boolean(searchQuery.trim() || since || until || filterYear || folderFilter || libraryView !== 'library' ||
      starredOnly || mayDoFilter || mayDoStatuses.length || selectedTags.length || noteFilter === 'unreadable');
  }

  function hasEmbeddings() {
    return Number(journalMeta?.embedded || 0) > 0 && journalMeta?.search?.semantic !== false;
  }

  function effectiveSort() { return sortChoice || (searchQuery.trim() ? 'relevance' : 'recent'); }
  function effectiveMode() { return modeChoice || (hasEmbeddings() ? 'hybrid' : 'lex'); }

  function inboxState() {
    return { q: searchQuery, tags: selectedTags, view: libraryView, mayDos: mayDoFilter, mayDoStatuses,
      folder: folderFilter, year: filterYear, month: filterMonth, since, until, sort: sortChoice, mode: modeChoice,
      unreadable: noteFilter === 'unreadable', starred: starredOnly, file: selectedFile, cue: landCue };
  }

  function saveSession() {
    try { sessionStorage.setItem('dw.workspace.v1', JSON.stringify(session.serialize())); } catch { /* Session is still usable in memory. */ }
  }

  function saveListAnchor(preferredFile = '') {
    const captured = noteList?.captureAnchor(preferredFile);
    const anchor = captured ? { ...captured, loaded: visibleItems.length } : null;
    if (anchor && committedKey) session.anchors.set(committedKey, anchor);
    return anchor || session.anchors.get(committedKey) || null;
  }

  function saveReader(pause = false) {
    if (!selectedFile || restoringReader) return;
    const mountedFile = detailScroll?.querySelector('[data-entry-key]')?.dataset.entryKey;
    const audio = mountedFile === selectedFile ? detailScroll?.querySelector('audio') : null;
    const current = { ...readerState, scroll: mountedFile === selectedFile ? detailScroll.scrollTop : readerState.scroll,
      time: audio?.dataset.positionRestored === 'true' ? audio.currentTime : readerState.time };
    if (pause) audio?.pause();
    session.readers.set(selectedFile, current);
    readerState = current;
  }

  function historySnapshot() {
    saveReader();
    saveSession();
    return { version: 1, anchor: session.anchors.get(committedKey) || null, returnFocusFile,
      reader: selectedFile ? session.reader(selectedFile) : null, browseSort };
  }

  function writeInboxUrl(kind = 'replace') {
    if (applyingUrl || historyReplay || !indexReady || kind === 'none') return;
    const next = inboxPath(inboxState());
    const current = `${location.pathname}${location.search}${location.hash}`;
    const state = { ...history.state, dwWorkspace: historySnapshot() };
    if (kind === 'push' && current !== next) history.pushState(state, '', next);
    else history.replaceState(state, '', next);
  }

  function assignFilters(state) {
    searchQuery = state.q; selectedTags = state.tags; mayDoFilter = state.mayDos;
    mayDoStatuses = state.mayDoStatuses; folderFilter = state.folder; libraryView = state.view;
    filterYear = state.year; filterMonth = state.month; since = state.since; until = state.until;
    sortChoice = state.sort; modeChoice = state.mode; starredOnly = state.starred;
    noteFilter = state.unreadable ? 'unreadable' : 'all';
  }

  function applyInboxUrl(search = location.search) {
    applyingUrl = true;
    const parsed = parseInboxUrl(search);
    assignFilters(parsed);
    landCue = parseCueHash(location.hash);
    applyingUrl = false;
    return parsed;
  }

  async function restoreList(anchor) {
    if (!anchor) { entryScroll?.scrollTo({ top: 0 }); return; }
    await tick();
    await noteList?.restoreAnchor(anchor);
  }

  async function resultsArrived(key) {
    committedKey = key;
    await tick();
    await restoreList(pendingAnchor || session.anchors.get(key));
    pendingAnchor = null;
  }

  async function loadBrowse() { return runRemoteFilter(); }

  function searchParams(state) {
    const params = new URLSearchParams({ page: '1', limit: '50' });
    const q = state.q.trim();
    const scope = scopeOf(state);
    if (q) params.set('q', q);
    if (scope.mayDos === 'any') params.set('mayDos', 'any');
    else for (const status of scope.mayDos) params.append('mayDoStatus', status);
    if (scope.folder) params.set('folder', scope.folder);
    if (scope.attention) params.set('attention', '1');
    for (const tag of state.tags) params.append('tag', tag);
    if (state.unreadable) params.set('unreadable', '1');
    if (scope.starred) params.set('starred', '1');
    for (const field of ['since', 'until', 'year', 'month']) if (scope[field]) params.set(field, scope[field]);
    params.set('sort', effectiveSort());
    if (q) params.set('mode', isFilenameQuery(q) ? 'lex' : effectiveMode());
    return params;
  }

  async function runRemoteFilter() {
    const request = ++filterRequest;
    const state = inboxState();
    const key = workspaceKey(state);
    inboxError = ''; requestBusy = true;
    searchController?.abort(); moreController?.abort(); moreRequest += 1; moreBusy = false;
    searchController = new AbortController();
    try {
      const params = searchParams(state);
      let data = await fetchJson(`/notes/search?${params}`, searchController.signal);
      if (request !== filterRequest) return;
      const wantedAnchor = pendingAnchor || session.anchors.get(key);
      const items = [...data.items];
      // Reconstruct only enough pages to restore a previously visited list position.
      while (wantedAnchor && data.hasMore && items.length < (wantedAnchor.loaded || 50) && !items.some(item => item.jsonFile === wantedAnchor.key)) {
        const continuation = new URLSearchParams(params); continuation.set('cursor', data.nextCursor);
        data = await fetchJson(`/notes/search?${continuation}`, searchController.signal);
        if (request !== filterRequest) return;
        items.push(...data.items);
      }
      saveListAnchor();
      remoteHits = items.map(noteFromHit);
      entryPage = data; pageParams = params.toString(); cursorExpired = false; moreError = '';
      await resultsArrived(key);
    } catch (error) {
      if (request === filterRequest && error.name !== 'AbortError') inboxError = error.message || String(error);
    } finally { if (request === filterRequest) requestBusy = false; }
  }

  async function loadMore() {
    if (moreBusy || requestBusy || committedKey !== searchKey || cursorExpired || !entryPage?.hasMore) return false;
    const request = ++moreRequest; const filter = filterRequest;
    moreBusy = true; moreError = '';
    moreController?.abort(); moreController = new AbortController();
    const keepPagingFocus = Boolean(document.activeElement?.closest('.paging-controls'));
    const params = new URLSearchParams(pageParams); params.set('cursor', entryPage.nextCursor);
    try {
      const data = await fetchJson(`/notes/search?${params}`, moreController.signal);
      if (request !== moreRequest || filter !== filterRequest) return false;
      const anchor = saveListAnchor();
      const existing = new Set(remoteHits.map(note => note.jsonFile));
      remoteHits = [...remoteHits, ...data.items.map(noteFromHit).filter(note => !existing.has(note.jsonFile))];
      entryPage = data;
      await tick(); await restoreList(anchor);
      if (keepPagingFocus && !data.hasMore) pagingComplete?.focus({ preventScroll: true });
      return true;
    } catch (error) {
      if (request === moreRequest && filter === filterRequest && error.name !== 'AbortError') {
        cursorExpired = error.code === 'cursor_expired' || error.code === 'invalid_cursor';
        moreError = error.message || String(error);
      }
      return false;
    } finally { if (request === moreRequest) moreBusy = false; }
  }

  async function refreshResults() {
    pendingAnchor = saveListAnchor();
    await runRemoteFilter();
  }

  function scheduleFilter(key) {
    saveListAnchor();
    lastSearchKey = key;
    filterRequest += 1; browseRequest += 1; browseBusy = false;
    searchController?.abort(); browseController?.abort(); moreController?.abort(); moreRequest += 1; moreBusy = false;
    requestBusy = true;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { writeInboxUrl(); void runRemoteFilter(); }, 180);
  }

  function submitSearch() {
    clearTimeout(searchTimer);
    lastSearchKey = workspaceKey(inboxState());
    writeInboxUrl();
    void runRemoteFilter();
  }

  $: searching = Boolean(searchQuery.trim());
  $: if (indexReady && searching !== wasSearching) {
    if (searching) { browseSort = sortChoice; sortChoice = ''; }
    else sortChoice = browseSort;
    wasSearching = searching;
  }
  $: filterState = { q: searchQuery, tags: selectedTags, view: libraryView, mayDos: mayDoFilter, mayDoStatuses,
    folder: folderFilter, year: filterYear, month: filterMonth, since, until, sort: sortChoice, mode: modeChoice,
    unreadable: noteFilter === 'unreadable', starred: starredOnly };
  $: searchKey = workspaceKey(filterState);
  $: if (indexReady && searchKey !== lastSearchKey && !historyReplay) scheduleFilter(searchKey);
  $: showHits = isHitMode(searchKey);
  $: groups = groupTranscriptions(transcriptions);
  $: tagCloud = tagRows.length
    ? (() => {
        const max = Math.max(1, ...tagRows.map((row) => row.count));
        return tagRows.map(({ tag, count }) => ({
          tag,
          count,
          size: `${0.8 + (count / max) * 0.7}rem`,
        }));
      })()
    : buildTagCloud(transcriptions);
  $: frequentTags = tagCloud.filter((item) => item.count > 1);
  $: singletonTags = tagCloud.filter((item) => item.count === 1);
  $: visibleTags = (() => {
    const pool = tagSearch.trim()
      ? tagCloud.filter(item => item.tag.toLowerCase().includes(tagSearch.trim().toLowerCase()))
      : showSingletons ? tagCloud : frequentTags;
    const capped = showAllFrequent || tagSearch.trim() ? pool : pool.slice(0, TAG_CLOUD_CAP);
    const extraSelected = tagCloud.filter(
      (item) => selectedTags.includes(item.tag) && !capped.some((shown) => shown.tag === item.tag)
    );
    return [...capped, ...extraSelected];
  })();
  $: browseItems = transcriptions.filter(note => folderOf(note.jsonFile).key !== 'holding').sort((a, b) => {
    const order = (b.day || displayName(b.jsonFile)).localeCompare(a.day || displayName(a.jsonFile)) || b.jsonFile.localeCompare(a.jsonFile);
    return effectiveSort(searchKey) === 'oldest' ? -order : order;
  });
  $: visibleItems = remoteHits !== null ? remoteHits : browseItems;
  $: selectedNote = selectedFile ? noteCache[selectedFile] || transcriptions.find(note => note.jsonFile === selectedFile) || remoteHits?.find(note => note.jsonFile === selectedFile) : null;
  $: outsideResults = Boolean(selectedFile && indexReady && !requestBusy && !browseBusy && committedKey === searchKey && !visibleItems.some(note => note.jsonFile === selectedFile));
  $: scope = scopeOf(filterState);
  $: activeStatuses = scope.mayDos === 'any' ? [] : scope.mayDos;
  $: optionalFilters = Boolean(mayDoFilter || mayDoStatuses.length || filterYear || selectedTags.length || since || until || starredOnly || noteFilter === 'unreadable' || folderFilter);
  $: viewLabel = { library: 'Library', starred: 'Starred', maydos: 'MayDos', attention: 'Needs attention' }[libraryView];
  $: statusLine = viewLabel + (filterYear ? ' · ' + filterYear + (filterMonth ? ' · ' + MONTHS[Number(filterMonth) - 1] : '') : '') + ' · ' +
    (requestBusy || browseBusy || !indexReady ? 'Updating entries…' : committedKey !== searchKey ? 'Could not update entries · previous results shown' : entryPage ? (entryPage.countKind === 'ranked' ? visibleItems.length + ' shown from ' + entryPage.total + ' ranked results · maximum ' + entryPage.candidateLimit : visibleItems.length + ' of ' + entryPage.total + ' entries') : 'Loading entries…');

  $: selectedActivity = activityItems.find(item=>item.jsonFile===selectedFile) || (pendingItem?.jsonFile===selectedFile ? pendingItem : null);
  $: if(indexReady && entryIntent && entryIntent.intentId!==handledIntent){handledIntent=entryIntent.intentId;void openEntry(entryIntent.jsonFile,{focus:true});}
  $: if(indexReady && selectedActivity?.hasTranscript && selectedNote?.transcriptionJson?._pending && !reconcilingPending && reconciledVersion!==selectedActivity.id+':'+selectedActivity.updatedAt) reconcilePending(selectedActivity);
  async function reconcilePending(item){reconciledVersion=item.id+':'+item.updatedAt;reconcilingPending=true;saveReader(true);restoringReader=true;try{await hydrateNote(item.jsonFile);await tick();if(selectedFile===item.jsonFile)detailScroll.scrollTop=readerState.scroll;}catch(error){if(selectedFile===item.jsonFile)detailError=error.message;}finally{if(selectedFile===item.jsonFile)restoringReader=false;reconcilingPending=false;}}

  function setDates(date) {
    filterYear = date.year; filterMonth = date.month; since = date.since; until = date.until;
  }
  function jumpYear(year, month = '') {
    setDates(chooseCalendarDate(year, month)); if (window.innerWidth < 1200) navigationOpen = false;
    if (compactMedia?.matches) void tick().then(() => (selectedFile ? detailHeading : searchInput)?.focus({ preventScroll: true }));
  }
  function toggleMayDoStatus(status) {
    const current = scopeOf(inboxState()).mayDos;
    mayDoStatuses = (Array.isArray(current) ? current : []).includes(status)
      ? current.filter(value => value !== status) : [...(Array.isArray(current) ? current : []), status];
    mayDoFilter = mayDoStatuses.length ? '' : libraryView === 'maydos' ? 'any' : '';
  }
  function setSort(value) { sortChoice = value; if (!searchQuery.trim()) browseSort = value; }

  function chooseLibrary(view) {
    navigationRequest += 1;
    saveListAnchor(); saveReader(); writeInboxUrl();
    assignFilters(clearOptionalFilters({ ...inboxState(), view, q: '', sort: '', mode: '' }));
    browseSort = ''; wasSearching = false; if (window.innerWidth < 1200) navigationOpen = false;
    writeInboxUrl('push');
    if (compactMedia?.matches) void tick().then(() => (selectedFile ? detailHeading : searchInput)?.focus({ preventScroll: true }));
  }

  function applyNote(data) {
    if (!data?.jsonFile) return data;
    const summary = transcriptions.find(note => note.jsonFile === data.jsonFile) || remoteHits?.find(note => note.jsonFile === data.jsonFile);
    data = { ...summary, ...data, day: data.day || summary?.day };
    noteCache = { ...noteCache, [data.jsonFile]: data };
    transcriptions = transcriptions.map(note => note.jsonFile === data.jsonFile ? data : note);
    if (remoteHits) remoteHits = remoteHits.map(note => note.jsonFile === data.jsonFile ? { ...note, ...data } : note);
    return data;
  }

  async function hydrateNote(jsonFile) {
    const response = await fetch(`/note?file=${encodeURIComponent(jsonFile)}&_=${Date.now()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'failed to load note');
    return applyNote(data);
  }

  async function openEntry(selection, { kind = 'push', focus = false, keepFocus = false, cue } = {}) {
    let jsonFile = typeof selection === 'string' ? selection : selection.file;
    focus = !keepFocus && (focus || Boolean(selection.keyboard) || Boolean(compactMedia?.matches));
    if (!jsonFile) return;
    if (selectedFile === jsonFile && !detailError) { if (typeof selection === 'object' && selection.tab) onReaderTab({ detail: { tab: selection.tab } }); return; }
    if (kind !== 'none') navigationRequest += 1;
    const anchor = saveListAnchor(jsonFile);
    saveReader(true);
    if (kind !== 'none') writeInboxUrl();
    const request = ++detailRequest;
    selectedFile = jsonFile;
    returnFocusFile = jsonFile;
    const targetReader = { ...session.reader(jsonFile) };
    if (typeof selection === 'object' && selection.tab) targetReader.tab = selection.tab;
    else if (kind !== 'none' && libraryView === 'maydos') targetReader.tab = 'maydos';
    readerState = targetReader; restoringReader = true;
    const neededHydration = !noteCache[jsonFile];
    detailLoading = neededHydration; detailError = '';
    landCue = cue !== undefined ? cue : remoteHits?.find(note => note.jsonFile === jsonFile)?.cue ?? null;
    writeInboxUrl(kind);
    await tick();
    if (request !== detailRequest) return;
    await restoreList(anchor);
    if (request !== detailRequest) return;
    if (!neededHydration) { if (landCue == null) detailScroll.scrollTop = targetReader.scroll; restoringReader = false; }
    if (focus) detailHeading?.focus({ preventScroll: true });
    else if (!keepFocus) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (request === detailRequest && (document.activeElement === document.body || entryScroll?.contains(document.activeElement))) noteList?.focusEntry(jsonFile);
    }
    try {
      let item = activityItems.find(item=>item.jsonFile===jsonFile);
      if (!activityReady && !item) {
        const snapshot = await fetchJson('/notes/activity');
        item = snapshot.items?.find(item=>item.jsonFile===jsonFile);
      }
      if (request !== detailRequest || selectedFile !== jsonFile) return;
      if (item && !item.hasTranscript) {
        pendingItem=item;
        applyNote({jsonFile,transcriptionJson:{displayTitle:item.originalName || '',_pending:true}});
        return;
      }
      await hydrateNote(jsonFile);
      if (request !== detailRequest || selectedFile !== jsonFile) return;
    } catch (error) {
      if (request === detailRequest) detailError = error.message || String(error);
    } finally {
      if (request === detailRequest) {
        detailLoading = false;
        await tick();
        if (neededHydration && selectedFile === jsonFile && landCue == null) detailScroll.scrollTop = targetReader.scroll;
        restoringReader = false;
      }
    }
  }

  async function restoreCardFocus(file) {
    await tick();
    await restoreList(session.anchors.get(committedKey));
    if (!noteList?.focusEntry(file)) {
      const nearest = visibleItems.find(note => note.jsonFile === session.anchors.get(committedKey)?.key) || visibleItems[0];
      if (!nearest || !noteList?.focusEntry(nearest.jsonFile)) searchInput?.focus({ preventScroll: true });
    }
  }

  async function closeDetail() {
    navigationRequest += 1;
    saveReader(true); saveListAnchor(); writeInboxUrl();
    const file = returnFocusFile || selectedFile;
    detailRequest += 1; restoringReader = false; selectedFile = ''; detailLoading = false; detailError = ''; landCue = null;
    writeInboxUrl('push');
    await restoreCardFocus(file);
  }

  async function stepEntry(direction) {
    const selected = selectedFile; const key = searchKey;
    let file = adjacentEntry(visibleItems, selected, direction);
    if (!file && direction === 1 && visibleItems.some(note => note.jsonFile === selected)) {
      if (await loadMore()) file = adjacentEntry(visibleItems, selected, direction);
    }
    if (file && selectedFile === selected && searchKey === key) void openEntry(file, { kind: 'replace', keepFocus: true });
  }

  function onReaderTab(event) {
    readerState = { ...readerState, tab: event.detail.tab };
    session.readers.set(selectedFile, { ...readerState }); saveSession();
  }

  async function saveTitle(file, displayTitle) {
    noteBusy = { ...noteBusy, [file]: true };
    try { const data = await postJson('/note', { file, displayTitle }); applyNote(data); }
    finally { noteBusy = { ...noteBusy, [file]: false }; }
  }

  async function extractNoteMayDos(jsonFile) {
    if (!connected) throw new Error('Reconnect before extracting actions.');
    const data = await postJson('/notes/may-dos/extract', { file: jsonFile });
    applyNote(data); await loadMeta();
    if (isHitMode()) await runRemoteFilter();
  }
  async function setMayDoStatus(jsonFile, id, status, expectedStatus) {
    if (!connected) throw new Error('Reconnect before changing this action.');
    const data = await postJson('/note', { file: jsonFile, mayDo: { id, status, expectedStatus } });
    applyNote(data); void loadMeta();
    if (isHitMode()) void runRemoteFilter();
  }

  async function withNoteBusy(jsonFile, work) {
    if(!connected){inboxError='Connection lost. Reconnect before changing this entry.';return;}
    noteBusy[jsonFile] = true;
    noteBusy = noteBusy;
    inboxError = '';
    try {
      await work();
    } catch (error) {
      inboxError = error.message || String(error);
    } finally {
      noteBusy[jsonFile] = false;
      noteBusy = noteBusy;
    }
  }

  async function retryCleanup(jsonFile) {
    await withNoteBusy(jsonFile, async () => {
      await postJson('/process/force', { file: jsonFile });
      await hydrateNote(jsonFile);
    });
  }

  async function skipNoteCleanup(jsonFile) {
    await withNoteBusy(jsonFile, async () => {
      await postJson('/process/skip', { file: jsonFile });
      await hydrateNote(jsonFile);
    });
  }

  async function resolveHolding(jsonFile, action) {
    organizationMode=action==='unfile'?'unfile':action==='rename'?'file':'date';organizationFile=jsonFile;
  }

  async function appliedOrganization(data) {
    if(data.keptExisting){removeAcknowledged(data.jsonFile);return;}
    const old=data.oldJsonFile,state=session.readers.get(old),wasSelected=selectedFile===old;
    removeAcknowledged(old,false);if(state)session.readers.set(data.jsonFile,state);applyNote(data);
    if(wasSelected){selectedFile=data.jsonFile;readerState=state||readerState;history.replaceState(null,'',inboxPath(inboxState()));}
    await loadMeta();await loadBrowse();
    if(wasSelected)await openEntry(data.jsonFile,{kind:'none',keepFocus:true});
  }
  function removeAcknowledged(file, close=true) {
    saveListAnchor();transcriptions=transcriptions.filter(note=>note.jsonFile!==file);
    if(remoteHits)remoteHits=remoteHits.filter(note=>note.jsonFile!==file);
    delete noteCache[file];noteCache={...noteCache};
    if(close&&selectedFile===file)closeDetail();
  }
  async function deleteTranscription(jsonFile) {
    await withNoteBusy(jsonFile,async()=>{
      let requestId=removalReceipts.get(jsonFile);if(!requestId){requestId=crypto.randomUUID();removalReceipts.set(jsonFile,requestId);}
      const data=await postJson('/notes/trash/remove',{file:jsonFile,requestId});
      removeAcknowledged(jsonFile);removalReceipts.delete(jsonFile);
      clearTimeout(trashTimer);trashUndo=data;trashTimer=setTimeout(()=>trashUndo=null,8000);await loadMeta();
    });
  }
  async function undoTrash() {
    if(!trashUndo||trashBusy)return;clearTimeout(trashTimer);trashBusy=true;inboxError='';
    try{const data=await postJson('/notes/trash/restore',{id:trashUndo.trashId});applyNote(data);trashUndo=null;await loadMeta();await loadBrowse();}
    catch(error){inboxError=error.message+' Open Settings → Trash to retry.';}
    finally{trashBusy=false;}
  }

  async function copyTranscription(transcription) {
    try {
      const item = await hydrateNote(transcription.jsonFile);
      const json = item?.transcriptionJson || {};
      const fromCues = (json.playbackCues || [])
        .map((cue) => String(cue.text || '').trim())
        .filter(Boolean);
      const text =
        (fromCues.length ? fromCues.join('\n\n') : '') ||
        String(json.cleanedTranscription || json.preview || '');
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error(error);
    }
  }

  async function starNote(jsonFile, next) {
    await withNoteBusy(jsonFile, async () => {
      const data = await postJson('/note', { file: jsonFile, starred: next });
      applyNote(data);
      await loadMeta();
      if (isHitMode()) await runRemoteFilter();
    });
  }

  async function saveTags(jsonFile, tags) {
    await withNoteBusy(jsonFile, async () => {
      const previous=[...((await hydrateNote(jsonFile))?.transcriptionJson?.tags||[])];
      const data = await postJson('/note', { file: jsonFile, tags });
      applyNote(data);
      clearTimeout(tagTimer);tagUndo={file:jsonFile,previous,expected:data.transcriptionJson.tags};tagTimer=setTimeout(()=>tagUndo=null,5000);
      await loadMeta();
      if (isHitMode()) await runRemoteFilter();
    });
  }
  async function undoTags(){if(!tagUndo||tagBusy)return;clearTimeout(tagTimer);tagBusy=true;
    try{const data=await postJson('/note',{file:tagUndo.file,tags:tagUndo.previous,expectedTags:tagUndo.expected});applyNote(data);tagUndo=null;await loadMeta();if(isHitMode())await runRemoteFilter();}
    catch(error){inboxError=error.message;}finally{tagBusy=false;}
  }

  function onAudioTime(item, event) {
    item.transcriptionJson._currentTime = event.currentTarget.currentTime;
    if (!restoringReader && item.jsonFile === selectedFile && event.currentTarget === detailScroll?.querySelector('audio')) { readerState = { ...readerState, time: event.currentTarget.currentTime }; session.readers.set(selectedFile, readerState); }
  }

  function clearSearch() {
    searchQuery = '';
  }

  function clearFilters() { assignFilters(clearOptionalFilters(inboxState())); }
  function resetView() {
    assignFilters(clearOptionalFilters({ ...inboxState(), q: '', sort: '', mode: '' }));
    browseSort = ''; wasSearching = false;
  }

  function upsertNote(data) {
    if (!data?.jsonFile) return;
    const i = transcriptions.findIndex((note) => note.jsonFile === data.jsonFile);
    if (i >= 0) {
      const current = transcriptions[i];
      if (data.transcriptionJson?._partial && current.transcriptionJson && !current.transcriptionJson._partial) {
        transcriptions[i] = {
          ...current,
          transcriptionJson: {
            ...current.transcriptionJson,
            tags: data.transcriptionJson.tags,
            starred: data.transcriptionJson.starred,
          },
        };
      } else {
        transcriptions[i] = data;
      }
      transcriptions = transcriptions;
    } else {
      transcriptions = [...transcriptions, data];
    }
  }

  function onNotesIndex(data) {
    indexing = Boolean(data?.indexing);
    if (data?.reload) {
      pagedIndex = true;
      const file = selectedFile;
      void (isHitMode() ? runRemoteFilter() : loadBrowse()).then(() => {
        if (file && selectedFile === file && !selectedNote?.transcriptionJson?._pending) return hydrateNote(file);
      }).catch((error) => {
        inboxError = error.message || String(error);
      });
      return;
    }
    if (remoteHits !== null) { scheduleFilter(searchKey); void loadMeta(); return; }
    if (data?.paged) {
      pagedIndex = true;
      mergeNotes(data.notes);
    } else if (data?.notes) {
      mergeNotes(data.notes, { replace: !pagedIndex });
    }
    if (selectedFile && !selectedNote?.transcriptionJson?._pending) void hydrateNote(selectedFile).catch(() => {});
    void loadMeta();
  }

  function onTranscription(data) {
    upsertNote(data);
    scheduleFilter(searchKey);
    if (data?.jsonFile && selectedFile === data.jsonFile && !selectedNote?.transcriptionJson?._pending) void hydrateNote(data.jsonFile).catch(error=>detailError=error.message);
  }

  async function onPopState() {
    const navigation = ++navigationRequest;
    saveListAnchor(); saveReader(true);
    clearTimeout(searchTimer);
    historyReplay = true;
    const previousFile = selectedFile;
    const parsed = applyInboxUrl();
    const snapshot = history.state?.dwWorkspace;
    browseSort = snapshot?.browseSort || (!parsed.q.trim() ? parsed.sort : '');
    wasSearching = Boolean(parsed.q.trim());
    if (snapshot?.reader && parsed.file && !session.readers.has(parsed.file)) session.readers.set(parsed.file, snapshot.reader);
    returnFocusFile = snapshot?.returnFocusFile || previousFile;
    pendingAnchor = snapshot?.anchor || session.anchors.get(workspaceKey(inboxState()));
    selectedFile = '';
    if (parsed.file) void openEntry(parsed.file, { kind: 'none', focus: true, cue: landCue });
    else { detailRequest += 1; restoringReader = false; detailLoading = false; detailError = ''; }
    await tick();
    lastSearchKey = workspaceKey(inboxState());
    historyReplay = false;
    await runRemoteFilter();
    if (navigation !== navigationRequest) return;
    if (!parsed.file) await restoreCardFocus(returnFocusFile);
  }

  function saveWorkspace() { saveListAnchor(); saveReader(); saveSession(); }

  function onPaneResize() {
    if (compactMedia.matches && entryScroll?.contains(document.activeElement) && selectedFile) detailHeading?.focus({ preventScroll: true });
  }

  onMount(() => {
    navigationOpen = window.innerWidth >= 1200;
    try {
      const saved = JSON.parse(sessionStorage.getItem('dw.workspace.v1') || '{}');
      if (saved.version === 1) session = createWorkspaceSession(saved);
    } catch { /* Ignore obsolete or unavailable storage. */ }
    compactMedia = window.matchMedia('(max-width: 959px)');
    compactMedia.addEventListener('change', onPaneResize);
    const parsed = applyInboxUrl();
    wasSearching = Boolean(parsed.q.trim());
    browseSort = !wasSearching ? parsed.sort : '';
    committedKey = workspaceKey(inboxState());
    pendingAnchor = history.state?.dwWorkspace?.anchor || session.anchors.get(committedKey);
    indexReady = true;
    lastSearchKey = committedKey;
    socket.on('notes-index', onNotesIndex); socket.on('transcription', onTranscription);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', saveWorkspace);
    void runRemoteFilter();
    void loadMeta();
    if (parsed.file) void openEntry(parsed.file, { kind: 'none', cue: landCue });
    writeInboxUrl();
    return () => {
      saveListAnchor(); saveReader(true); saveSession();
      socket.off('notes-index', onNotesIndex); socket.off('transcription', onTranscription);
      window.removeEventListener('popstate', onPopState); window.removeEventListener('pagehide', saveWorkspace); compactMedia.removeEventListener('change', onPaneResize);
      clearTimeout(searchTimer); filterRequest += 1; browseRequest += 1; detailRequest += 1;
      searchController?.abort(); browseController?.abort(); moreController?.abort(); moreRequest += 1; moreBusy = false;
    };
  });
</script>
<OrganizationDialog bind:file={organizationFile} initialMode={organizationMode} {connected} on:applied={event=>appliedOrganization(event.detail)} />
{#if tagUndo}<div class="trash-undo tag-undo" role="status">Tags saved. <button class="dw-btn-secondary" disabled={!connected||tagBusy} on:click={undoTags}>{tagBusy?'Restoring tags…':'Undo tag change'}</button></div>{/if}
{#if trashUndo}<div class="trash-undo" role="status">Entry moved to Trash. <button class="dw-btn-secondary" disabled={!connected||trashBusy} on:click={undoTrash}>{trashBusy?'Restoring…':'Undo'}</button><button class="dw-text-btn" on:click={()=>{trashUndo=null;dispatch('opentrash');}}>Open Trash</button></div>{/if}

<svelte:window on:keydown={event => { if(!event.target.closest?.('input,textarea,select,[contenteditable=true]') && !document.querySelector('dialog[open]')){if(event.key==='/'){event.preventDefault();searchInput?.focus();}else if(event.key==='?'){event.preventDefault();dispatch('help');}}  if (event.key === 'Escape' && filtersOpen && event.target.closest?.('#note-filters')) { filtersOpen = false; filterButton.focus(); } }} />

<section class="transcriptions" class:rail-open={navigationOpen}>
  <LibraryRail bind:open={navigationOpen}>
    <div class="library-body">
      <p class="dw-eyebrow">Library</p>
      <nav class="library-links" aria-label="Library views">
        <button class:is-active={libraryView === 'library'} aria-current={libraryView === 'library' ? 'page' : undefined} on:click={() => chooseLibrary('library')}>Library</button>
        <button class:is-active={libraryView === 'starred'} aria-current={libraryView === 'starred' ? 'page' : undefined} on:click={() => chooseLibrary('starred')}>★ Starred <span>{journalMeta?.starred || 0}</span></button>
        <button class:is-active={libraryView === 'maydos'} aria-current={libraryView === 'maydos' ? 'page' : undefined} on:click={() => chooseLibrary('maydos')}>MayDos</button>
        <button class:is-active={libraryView === 'attention'} aria-current={libraryView === 'attention' ? 'page' : undefined} on:click={() => chooseLibrary('attention')}>Needs attention</button>
      </nav>
        {#if tagCloud.length}
    <details class="tags-card">
      <summary>Tags</summary>
      <input class="dw-input tag-search" type="search" bind:value={tagSearch} placeholder="Find a tag…" aria-label="Find a tag" />
      <div class="tags-head">
        <p class="dw-eyebrow">Tags</p>
        <p class="dw-muted">
          {visibleTags.length} shown
          {#if !showSingletons && singletonTags.length}
            · {singletonTags.length} single-use hidden
          {/if}
          {#if !showAllFrequent && (showSingletons ? tagCloud : frequentTags).length > TAG_CLOUD_CAP}
            · {(showSingletons ? tagCloud : frequentTags).length - TAG_CLOUD_CAP} more
          {/if}
        </p>
      </div>
      {#if selectedTags.length}
        <div class="tags-filter">
          <span class="dw-muted">AND {selectedTags.join(' + ')}</span>
        </div>
      {/if}
      <div class="tag-cloud-body">
        {#each visibleTags as item}
          <button
            type="button"
            class="dw-chip"
            class:is-active={selectedTags.includes(item.tag)}
            on:click={() => toggleTag(item.tag)}
          >
            {item.tag}
            <span class="dw-chip-count">{item.count}</span>
          </button>
        {/each}
      </div>
      <div class="tag-cloud-more">
        {#if !showAllFrequent && (showSingletons ? tagCloud : frequentTags).length > TAG_CLOUD_CAP}
          <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => (showAllFrequent = true)}>
            Show all {(showSingletons ? tagCloud : frequentTags).length} listed tags
          </button>
        {/if}
        {#if singletonTags.length}
          <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => (showSingletons = !showSingletons)}>
            {showSingletons ? 'Hide single-use tags' : `Show ${singletonTags.length} single-use tags`}
          </button>
        {/if}
      </div>
      <button class="dw-text-btn" on:click={()=>dispatch('maintenance')}>Manage tags in Settings</button>
    </details>
  {/if}
      <p class="dw-eyebrow date-heading">Dates</p>
      <nav class="date-nav" aria-label="Browse by date">
        {#each yearCounts as row}
          <div class="date-year">
            <div class="year-row">
              <button class="year-chevron" aria-label={`Show months in ${row.year}`} aria-expanded={Boolean(expandedYears[row.year])} on:click={() => (expandedYears = { ...expandedYears, [row.year]: !expandedYears[row.year] })}>{expandedYears[row.year] ? '▾' : '▸'}</button>
              <button class:is-active={filterYear === row.year} on:click={() => jumpYear(row.year)}>{row.year}<span class="dw-chip-count">{row.count}</span></button>
            </div>
            {#if expandedYears[row.year] || filterYear === row.year}
              <div class="year-months">
                {#each MONTHS as month, index}
                  <button class:is-active={filterYear === row.year && filterMonth === String(index + 1).padStart(2, '0')} on:click={() => jumpYear(row.year, String(index + 1).padStart(2, '0'))}>{month}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </nav>



    </div>
  </LibraryRail>
  <div class="entry-workspace" class:with-detail={selectedFile}>
    <EntryListPane loading={requestBusy || moreBusy} hiddenOnMobile={Boolean(selectedFile)} bind:scrollElement={entryScroll} on:scroll={() => saveListAnchor()}>
    <div slot="search" class="dw-card search-card">
      <div class="search">
        <input class="dw-input" type="search" bind:this={searchInput} bind:value={searchQuery} on:keydown={event => { if (event.key === 'Enter') submitSearch(); }} placeholder="Search entries" aria-label="Search entries" />
        {#if searchQuery}<button class="dw-text-btn" on:click={clearSearch}>Clear search</button>{/if}
      </div>
      <div class="results-toolbar">
        <p class="dw-muted status-line" role="status">{statusLine}</p>
        <button class="dw-chip" class:is-active={scope.mayDos === 'any' || activeStatuses.length > 0} aria-pressed={scope.mayDos === 'any' || activeStatuses.length > 0} disabled={libraryView === 'maydos'} title={libraryView === 'maydos' ? 'MayDos view includes entries with actions' : 'Filter entries with any saved MayDos'} on:click={() => { mayDoFilter = mayDoFilter ? '' : 'any'; mayDoStatuses = []; }}>MayDos</button>
        <button class="dw-chip" class:is-active={scope.starred} aria-pressed={scope.starred} disabled={libraryView === 'starred'} title={libraryView === 'starred' ? 'Starred view includes starred entries' : 'Filter starred entries'} on:click={() => (starredOnly = !starredOnly)}>★ Starred</button>
        <button class="dw-btn-secondary dw-btn-compact" aria-expanded={filtersOpen} bind:this={filterButton} aria-controls="note-filters" on:click={() => (filtersOpen = !filtersOpen)}>Filters</button>
        <label class="sort-label">Sort
          <select class="dw-input dw-select" value={effectiveSort(searchKey)} on:change={event => setSort(event.target.value)}>
            <option value="recent">Newest first</option><option value="oldest">Oldest first</option>
            {#if searchQuery.trim()}<option value="relevance">Best match</option>{/if}
          </select>
        </label>
      </div>
      {#if libraryView === 'maydos'}
        <div class="maydo-view-status"><details><summary>More</summary><button class="dw-text-btn" on:click={() => dispatch('backfill')}>Extract from older entries</button></details>{#if mayDoJob?.id && (mayDoJob.running || mayDoJob.remaining || mayDoJob.failed)}<button class="dw-text-btn" on:click={() => dispatch('backfill')}>Backfill · {mayDoJob.state} · {mayDoJob.processed}/{mayDoJob.total}</button>{/if}</div>
      {/if}
      {#if optionalFilters}
        <div class="active-filters" aria-label="Active filters">
          {#if mayDoFilter}<button class="dw-chip is-active" on:click={() => (mayDoFilter = '')}>MayDos · {mayDoFilter === 'any' ? 'Any status' : mayDoFilter} ×</button>{/if}
          {#each mayDoStatuses as status}<button class="dw-chip is-active" aria-label={`Remove ${status} status filter`} on:click={() => { mayDoStatuses = mayDoStatuses.filter(value => value !== status); }}>{status} ×</button>{/each}
          {#if filterYear}<button class="dw-chip is-active" aria-label="Remove date filter" on:click={() => setDates(chooseCalendarDate(''))}>{filterYear}{filterMonth ? ' · ' + MONTHS[Number(filterMonth) - 1] : ''} ×</button>{/if}
          {#each selectedTags as tag}<button class="dw-chip is-active" aria-label={'Remove tag ' + tag} on:click={() => toggleTag(tag)}>{tag} ×</button>{/each}
          {#if since}<button class="dw-chip is-active" on:click={() => (since = '')}>From {since} ×</button>{/if}
          {#if until}<button class="dw-chip is-active" on:click={() => (until = '')}>To {until} ×</button>{/if}
          {#if starredOnly}<button class="dw-chip is-active" on:click={() => (starredOnly = false)}>Starred ×</button>{/if}
          {#if noteFilter === 'unreadable'}<button class="dw-chip is-active" on:click={() => (noteFilter = 'all')}>Unreadable audio ×</button>{/if}
          {#if folderFilter}<button class="dw-chip is-active" on:click={() => (folderFilter = '')}>{folderFilter} ×</button>{/if}
          <button class="dw-text-btn" on:click={clearFilters}>Clear filters</button>
        </div>
      {/if}
      {#if filtersOpen}
        <div class="filter-row" id="note-filters" role="group" aria-label="Entry filters">
          <fieldset class="maydo-filters"><legend>MayDo statuses (any selected)</legend>
            <label><input type="checkbox" checked={mayDoFilter === 'any'} on:change={event => { mayDoFilter = event.target.checked ? 'any' : ''; mayDoStatuses = []; }} />Any saved MayDos</label>
            {#each MAY_DO_STATUSES as status}<label><input type="checkbox" checked={activeStatuses.includes(status)} on:change={() => toggleMayDoStatus(status)} />{status[0].toUpperCase() + status.slice(1)}</label>{/each}
          </fieldset>
          <label class="filter-field">Year<select class="dw-input dw-select" value={filterYear} on:change={event => setDates(chooseCalendarDate(event.target.value))}><option value="">All years</option>{#each yearCounts as row}<option value={row.year}>{row.year}</option>{/each}</select></label>
          <label class="filter-field">Month<select class="dw-input dw-select" value={filterMonth} on:change={event => setDates(chooseCalendarDate(filterYear, event.target.value))} disabled={!filterYear}><option value="">All months</option>{#each MONTHS as month, index}<option value={String(index + 1).padStart(2, '0')}>{month}</option>{/each}</select></label>
          <label class="filter-field">From<input class="dw-input dw-select" type="date" value={since} on:change={event => setDates(chooseCustomDate(event.target.value, until))} /></label>
          <label class="filter-field">To<input class="dw-input dw-select" type="date" value={until} on:change={event => setDates(chooseCustomDate(since, event.target.value))} /></label>
          <label class="filter-field">Folder<select class="dw-input dw-select" bind:value={folderFilter}><option value="">View default</option><option value="unfiled">Unfiled</option><option value="holding">Holding</option></select></label>
          <label class="filter-field"><input type="checkbox" checked={noteFilter === 'unreadable'} on:change={event => (noteFilter = event.target.checked ? 'unreadable' : 'all')} />Unreadable audio</label>
          {#if hasEmbeddings()}<label class="filter-field">Search mode<select class="dw-input dw-select" value={effectiveMode()} on:change={event => (modeChoice = event.target.value)}><option value="lex">Search words only</option><option value="hybrid">Words and meaning</option></select></label>{/if}
          <button class="dw-text-btn" on:click={clearFilters}>Clear filters</button>
          <button class="dw-text-btn" on:click={resetView}>Reset view</button>
          <button class="dw-btn-secondary dw-btn-compact" on:click={() => { filtersOpen = false; filterButton.focus(); }}>Close filters</button>
        </div>
      {/if}
    </div>
            {#if inboxError}<p class="dw-error" role="alert">{inboxError} <button class="dw-text-btn" on:click={refreshResults}>Retry updating entries</button></p>{/if}
    {#if !visibleItems.length && (requestBusy || browseBusy || !indexReady)}
      <p class="dw-empty">{showHits ? 'Searching…' : 'Loading notes…'}</p>
    {:else if !visibleItems.length}
      <p class="dw-empty">{indexing ? 'Indexing notes…' : 'No notes match this view.'} {#if searchQuery || filterYear || selectedTags.length || starredOnly || mayDoFilter || mayDoStatuses.length}<button class="dw-text-btn" on:click={() => { resetView(); }}>Reset search and filters</button>{/if}</p>
    {:else}
      <section class="notes" aria-label={showHits ? 'Matching notes' : 'Journal entries'}>
                  <NoteList
            items={visibleItems} {activityItems}
            variant={showHits ? 'hit' : 'note'}
            query={searchQuery}
            {selectedTags}
            {selectedFile}
            compact={Boolean(selectedFile)}
            bind:this={noteList}
            {showRaw}
            noteBusy={connected ? noteBusy : Object.fromEntries(visibleItems.map(item=>[item.jsonFile,true]))}
            landFile={selectedFile}
            {landCue}
            on:toggle={(event) => openEntry(event.detail)}
            on:star={(event) => starNote(event.detail.jsonFile, event.detail.starred)}
            on:tag={(event) => toggleTag(event.detail)}
            on:savetags={(event) => saveTags(event.detail.jsonFile, event.detail.tags)}
            on:raw={(event) => {
              showRaw[event.detail.jsonFile] = event.detail.show;
              showRaw = showRaw;
            }}
            on:time={(event) => onAudioTime(event.detail.item, event.detail.event)}
            on:copy={(event) => copyTranscription(event.detail)}
            on:retry={(event) => retryCleanup(event.detail)}
            on:skip={(event) => skipNoteCleanup(event.detail)}
            on:resolve={(event) => resolveHolding(event.detail.jsonFile, event.detail.action)}
            on:delete={(event) => deleteTranscription(event.detail)}
          />
      </section>
    {/if}
    <div slot="paging" class="paging-controls" aria-live="polite">
      {#if moreError}<p class="dw-error" role="alert">{moreError}</p>{/if}
      {#if cursorExpired}<button class="dw-btn-secondary" disabled={requestBusy} on:click={refreshResults}>Refresh results</button>
      {:else if entryPage?.hasMore}<button class="dw-btn-secondary" disabled={requestBusy || moreBusy || committedKey !== searchKey} on:click={loadMore}>{moreBusy ? 'Loading more…' : moreError ? 'Retry loading more' : 'Load more'}</button>{/if}
      {#if entryPage && !entryPage.hasMore && entryPage.total > 50}<p bind:this={pagingComplete} tabindex="-1">All {entryPage.total} {entryPage.countKind === 'ranked' ? 'ranked results' : 'entries'} loaded.</p>{/if}
      {#if entryPage?.countKind === 'ranked' && searching}<button class="dw-text-btn" on:click={() => { modeChoice = 'lex'; }}>Search words only</button>{/if}
    </div>
    </EntryListPane>
      {#if selectedFile}
        <EntryReader title={entryPresentation(selectedNote || { jsonFile: selectedFile }).title} dateLabel={entryPresentation(selectedNote || { jsonFile: selectedFile }).dateLabel} starred={Boolean(selectedNote?.transcriptionJson?.starred)} busy={!connected || Boolean(noteBusy[selectedFile]) || Boolean(selectedNote?.transcriptionJson?._pending)} previousDisabled={requestBusy || committedKey !== searchKey || !adjacentEntry(visibleItems, selectedFile, -1)} nextDisabled={requestBusy || committedKey !== searchKey || (!adjacentEntry(visibleItems, selectedFile, 1) && (!entryPage?.hasMore || cursorExpired || !visibleItems.some(note => note.jsonFile === selectedFile)))} bind:heading={detailHeading} bind:scrollElement={detailScroll} on:scroll={() => saveReader()} on:previous={() => stepEntry(-1)} on:next={() => stepEntry(1)} on:close={closeDetail} on:star={() => starNote(selectedFile, !selectedNote?.transcriptionJson?.starred)}>
            {#if cursorExpired}<p class="outside-results" role="status">Results changed or expired. <button class="dw-text-btn" disabled={requestBusy} on:click={refreshResults}>Refresh results</button></p>
            {:else if moreError}<p class="dw-error" role="alert">{moreError} <button class="dw-text-btn" on:click={loadMore}>Retry loading more</button></p>{/if}
            {#if outsideResults}<p class="outside-results" role="status">This entry is outside the current results. <button class="dw-text-btn" on:click={closeDetail}>Close entry</button></p>{/if}
            {#if detailError}<p class="dw-error" role="alert">{detailError}</p><button class="dw-btn-secondary" on:click={() => { void openEntry(selectedFile, { kind: 'none', keepFocus: true }); }}>Retry opening entry</button>
            {:else if detailLoading}<p class="dw-empty">Loading entry…</p>
            {:else if selectedNote}
              {#if selectedNote.transcriptionJson?._pending && selectedActivity}<PendingEntry item={selectedActivity} savedTime={readerState.time} on:time={event=>onAudioTime(selectedNote,event.detail)} />
              {:else}{#key selectedFile}
                <NoteCard transcription={selectedNote} variant="detail" activityItem={selectedActivity} expanded={true} selected={true} query={searchQuery} {selectedTags} showRaw={Boolean(showRaw[selectedFile])} busy={!connected || Boolean(noteBusy[selectedFile]) || Boolean(selectedNote?.transcriptionJson?._pending)} detailTab={readerState.tab} savedTime={readerState.time} on:tab={onReaderTab} saveDisplayTitle={saveTitle} {landCue} {connected} saveMayDoStatus={setMayDoStatus} extractMayDos={extractNoteMayDos} on:configurecleanup={() => dispatch('configurecleanup')}
                              on:toggle={(event) => openEntry(event.detail)}
            on:star={(event) => starNote(event.detail.jsonFile, event.detail.starred)}
            on:tag={(event) => toggleTag(event.detail)}
            on:savetags={(event) => saveTags(event.detail.jsonFile, event.detail.tags)}
            on:raw={(event) => {
              showRaw[event.detail.jsonFile] = event.detail.show;
              showRaw = showRaw;
            }}
            on:time={(event) => onAudioTime(event.detail.item, event.detail.event)}
            on:copy={(event) => copyTranscription(event.detail)}
            on:retry={(event) => retryCleanup(event.detail)}
            on:skip={(event) => skipNoteCleanup(event.detail)}
            on:resolve={(event) => resolveHolding(event.detail.jsonFile, event.detail.action)}
            on:delete={(event) => deleteTranscription(event.detail)}

                  on:extractmaydos={event => extractNoteMayDos(event.detail)}
                  on:maydostatus={event => setMayDoStatus(event.detail.jsonFile, event.detail.id, event.detail.status)}
                />
              {/key}{/if}
            {:else}<p class="dw-empty">This entry is unavailable.</p>{/if}
        </EntryReader>
      {/if}
  </div>
</section>

<style lang="scss">
  .trash-undo { position: fixed; z-index: 90; bottom: 16px; left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 24px); display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 14px; color: var(--dw-text); background: #18181b; border: 1px solid var(--dw-border); border-radius: 12px; box-shadow: 0 6px 24px #0008; }
  .tag-undo { bottom: 100px; }
  .trash-undo button { min-height: 44px; }

  .paging-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; }
  .paging-controls:empty { display: none; }
  .paging-controls p { flex-basis: 100%; }
  .paging-controls p:focus { outline: 1px solid var(--dw-accent); outline-offset: 3px; }
  .paging-controls button { min-height: 44px; }
  .transcriptions { height: 100%; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: stretch; }
  .library-body { display: flex; flex-direction: column; gap: 0.65rem; }
  .library-links { display: flex; flex-direction: column; gap: 0.2rem; }
  .library-links button, .date-nav button { display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; border-radius: 0.5rem; padding: 0.5rem 0.65rem; background: transparent; color: var(--dw-text-muted); font: inherit; font-size: 0.875rem; cursor: pointer; text-align: left; }
  .library-links button:hover, .date-nav button:hover { background: var(--dw-bg-hover); color: var(--dw-text); }
  .library-links button.is-active, .date-nav button.is-active { background: rgb(245 158 11 / 0.12); color: var(--dw-accent-bright); }
  .library-links button span { font-size: 0.75rem; }
  .date-heading { margin-top: 0.6rem; }
  summary { cursor: pointer; padding: 0.5rem 0; color: var(--dw-text); font-size: 0.875rem; }
  .year-row { display: flex; align-items: center; }
  .date-nav .year-chevron { width: 2rem; flex-shrink: 0; padding: 0.5rem; }
  .year-months { padding-left: 1rem; }
  .outside-results { font-size: 0.8125rem; padding: 0.5rem; border-bottom: 1px solid var(--dw-border); }
  .maydo-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; border: 1px solid var(--dw-border); border-radius: 0.5rem; padding: 0.5rem; max-width: 100%; }
  .maydo-filters legend, .maydo-filters label { font-size: 0.8125rem; }
  .date-nav button { padding-left: 1.1rem; font-size: 0.8125rem; }
  .tags-card { border-top: 1px solid var(--dw-border); padding-top: 0.35rem; }
  .tag-search { margin: 0.25rem 0 0.65rem; padding: 0.45rem 0.6rem; font-size: 0.8125rem; }
  .tags-head { display: none; }
  .tags-filter { display: none; }
  .tag-cloud-body, .tag-cloud-more { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tag-cloud-body { max-height: 20rem; overflow-y: auto; }
  .tag-cloud-body .dw-chip { max-width: 100%; overflow-wrap: anywhere; text-align: left; white-space: normal; }
  .tag-cloud-more { margin-top: 0.65rem; }
  .search-card { padding: 8px; margin-bottom: 8px; box-shadow: none; }
  .search { display: flex; align-items: center; gap: 0.5rem; }
  .search .dw-input { min-width: 0; }
  .search .dw-text-btn { flex-shrink: 0; }
  .results-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.65rem; }
  .status-line { margin-right: auto; font-size: 0.8125rem; font-variant-numeric: tabular-nums; }
  .sort-label { display: flex; align-items: center; gap: 0.4rem; color: var(--dw-text-muted); font-size: 0.8125rem; }
  .dw-select { width: auto; min-width: 8rem; padding: 0.4rem 0.6rem; font-size: 0.8125rem; }
  .active-filters { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.65rem; }
  .filter-row { display: flex; flex-wrap: wrap; align-items: end; gap: 0.65rem; padding-top: 0.85rem; margin-top: 0.75rem; border-top: 1px solid var(--dw-border); }
  .filter-field { display: flex; flex-direction: column; gap: 0.25rem; color: var(--dw-text-muted); font-size: 0.75rem; }
  .notes { display: flex; flex-direction: column; gap: 0.5rem; }
  .dw-error { margin-bottom: 0.75rem; }
  .entry-workspace { min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .entry-workspace.with-detail { grid-template-columns: 360px minmax(440px, 1fr); }
  .status-line { flex-basis: 100%; }
  .sort-label { margin-left: auto; }
  @media (min-width: 1200px) { .transcriptions.rail-open { grid-template-columns: 200px minmax(0, 1fr); } }
  @media (min-width: 960px) and (max-width: 1199px) { .entry-workspace.with-detail { grid-template-columns: 320px minmax(0, 1fr); } }
  @media (max-width: 959px), (pointer: coarse) { .outside-results button, .dw-error button { min-height: 44px; } }
  @media (max-width: 959px) {
    .entry-workspace, .entry-workspace.with-detail { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .search { flex-wrap: wrap; }
  }
</style>
