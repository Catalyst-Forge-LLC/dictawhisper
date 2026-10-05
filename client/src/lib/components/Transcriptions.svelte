<script>
  import { onMount } from 'svelte';
  import { inboxPath, isFilenameQuery, parseCueHash, parseInboxUrl, tightenFilenameHits } from '../inboxUrl.js';
  import { displayName } from '../markPreview.js';
  import NoteList from './NoteList.svelte';

  export let transcriptions = [];
  export let socket;
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

  let expanded = {};
  let showRaw = {};
  let libraryView = 'recent';
  let navigationOpen = false;
  let filtersOpen = false;
  let tagSearch = '';
  let browseRequest = 0;
  let filterRequest = 0;
  let browseBusy = false;
  let selectedTags = [];
  let showSingletons = false;
  let showAllFrequent = false;
  let useModelForTags = true;
  let consolidateBusy = false;
  let consolidatePhase = '';
  let consolidateError = '';
  let consolidatePlan = null;
  let consolidateSelected = {};
  let applyBusy = false;
  let applyResult = null;
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

  function reasonLabel(reason) {
    if (reason === 'spelling') return 'spelling / plural';
    if (reason === 'similar') return 'close spelling';
    return 'same topic';
  }

  function selectedConsolidateGroups() {
    if (!consolidatePlan?.groups) return [];
    return consolidatePlan.groups.filter((_, index) => consolidateSelected[index] !== false);
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `request failed (${response.status})`);
    return data;
  }

  async function previewConsolidate() {
    consolidateBusy = true;
    consolidateError = '';
    applyResult = null;
    consolidatePlan = null;
    try {
      consolidatePhase = 'Finding spelling twins…';
      const local = await postJson('/tags/consolidate/preview', { useModel: false });
      consolidatePlan = local;
      consolidateSelected = Object.fromEntries((local.groups || []).map((_, index) => [index, true]));
      consolidateBusy = false;
      if (useModelForTags) {
        consolidatePhase = 'Asking the cleanup model for close synonyms…';
        const full = await postJson('/tags/consolidate/preview', { useModel: true });
        consolidatePlan = full;
        consolidateSelected = Object.fromEntries((full.groups || []).map((_, index) => [index, true]));
        if (full.modelError) consolidateError = `Model skipped: ${full.modelError}`;
      }
    } catch (error) {
      consolidateError = error.message || String(error);
    } finally {
      consolidateBusy = false;
      consolidatePhase = '';
    }
  }

  async function applyConsolidate() {
    const groups = selectedConsolidateGroups().map((group) => ({
      keep: group.keep,
      drop: group.drop,
    }));
    if (!groups.length) {
      consolidateError = 'Select at least one merge.';
      return;
    }
    applyBusy = true;
    consolidateError = '';
    try {
      const result = await postJson('/tags/consolidate/apply', { groups });
      applyResult = result;
      const mapping = result.mapping || {};
      selectedTags = [...new Set(selectedTags.map((tag) => mapping[tag] || tag))];
      await loadMeta();
      consolidatePlan = { ...consolidatePlan, groups: [] };
      consolidateSelected = {};
    } catch (error) {
      consolidateError = error.message || String(error);
    } finally {
      applyBusy = false;
    }
  }

  function dismissConsolidate() {
    consolidatePlan = null;
    consolidateSelected = {};
    consolidateError = '';
    applyResult = null;
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
        tags: hit.tags || json.tags || [],
        preview: hit.preview || json.preview || '',
        hasCleaned: hit.hasCleaned ?? json.hasCleaned,
        audioError: hit.audioError || json.audioError || null,
        starred: Boolean(hit.starred ?? json.starred),
        _partial: json._partial !== false,
        ...json,
        tags: hit.tags || json.tags || [],
        starred: Boolean(hit.starred ?? json.starred),
      },
    };
  }

  function mergeNotes(notes, { replace = false } = {}) {
    const incoming = (notes || []).map(noteFromHit);
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

  async function fetchJson(url) {
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `request failed (${response.status})`);
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
    return Boolean(
      searchQuery.trim() ||
        since ||
        until ||
        starredOnly ||
        selectedTags.length ||
        noteFilter === 'unreadable'
    );
  }

  function hasEmbeddings() {
    return Number(journalMeta?.embedded || 0) > 0 && journalMeta?.search?.semantic !== false;
  }

  function effectiveSort() {
    if (sortChoice) return sortChoice;
    return searchQuery.trim() ? 'relevance' : 'recent';
  }

  function effectiveMode() {
    if (modeChoice) return modeChoice;
    return hasEmbeddings() ? 'hybrid' : 'lex';
  }

  function inboxState() {
    const defSort = searchQuery.trim() ? 'relevance' : 'recent';
    const defMode = hasEmbeddings() ? 'hybrid' : 'lex';
    return {
      q: searchQuery,
      tags: selectedTags,
      view: libraryView,
      year: filterYear,
      month: filterMonth,
      since,
      until,
      sort: sortChoice && sortChoice !== defSort ? sortChoice : '',
      mode: modeChoice && modeChoice !== defMode ? modeChoice : '',
      unreadable: noteFilter === 'unreadable',
      starred: starredOnly,
      file: Object.keys(expanded).find((key) => expanded[key]) || '',
      cue: landCue,
    };
  }

  function writeInboxUrl() {
    if (applyingUrl || !indexReady) return;
    const next = inboxPath(inboxState());
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current === next || (next === '/' && !location.search && !location.hash && location.pathname === '/')) {
      return;
    }
    history.replaceState(history.state, '', next);
  }

  function applyInboxUrl(search = location.search) {
    applyingUrl = true;
    const parsed = parseInboxUrl(search);
    searchQuery = parsed.q;
    selectedTags = parsed.tags;
    libraryView = parsed.view || 'recent';
    filterYear = parsed.year;
    filterMonth = parsed.month;
    since = parsed.since;
    until = parsed.until;
    sortChoice = parsed.sort;
    modeChoice = parsed.mode;
    starredOnly = parsed.starred;
    noteFilter = parsed.unreadable ? 'unreadable' : 'all';
    if (parsed.file) expanded = { ...expanded, [parsed.file]: true };
    landCue = parseCueHash(typeof location !== 'undefined' ? location.hash : '');
    applyingUrl = false;
  }

  async function loadBrowse() {
    const request = ++browseRequest;
    const browseKey = [libraryView, filterYear, filterMonth].join('|');
    browseBusy = true;
    const params = new URLSearchParams();
    if (filterYear) {
      params.set('year', filterYear);
      if (filterMonth) params.set('month', filterMonth);
    } else if (libraryView === 'all') params.set('all', '1');
    try {
      const data = await fetchJson('/notes/index?' + params);
      if (request !== browseRequest) return;
      pagedIndex = Boolean(data.paged);
      indexing = Boolean(data.indexing);
      mergeNotes(data.notes, { replace: true });
      lastBrowseKey = browseKey;
      await loadMeta();
    } finally {
      if (request === browseRequest) browseBusy = false;
    }
  }

  async function runRemoteFilter() {
    const request = ++filterRequest;
    inboxError = '';
    if (!isHitMode()) {
      remoteHits = null;
      const browseKey = [libraryView, filterYear, filterMonth].join('|');
      if (browseKey !== lastBrowseKey) {
        try { await loadBrowse(); }
        catch (error) { inboxError = error.message || String(error); }
      } else browseBusy = false;
      return;
    }
    try {
      remoteHits = null;
      const params = new URLSearchParams();
      const q = searchQuery.trim();
      if (q) params.set('q', q);
      params.set('limit', '50');
      if (libraryView === 'unfiled' || libraryView === 'holding') params.set('folder', libraryView);
      for (const tag of selectedTags) params.append('tag', tag);
      if (noteFilter === 'unreadable') params.set('unreadable', '1');
      if (starredOnly) params.set('starred', '1');
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      if (filterYear) params.set('year', filterYear);
      if (filterYear && filterMonth) params.set('month', filterMonth);
      params.set('sort', effectiveSort());
      if (q && !isFilenameQuery(q)) params.set('mode', effectiveMode());
      else if (q) params.set('mode', 'lex');
      const data = await fetchJson(`/notes/search?${params}`);
      if (request !== filterRequest) return;
      remoteHits = tightenFilenameHits(q, (data.hits || data.notes || []).map(noteFromHit));
    } catch (error) {
      if (request === filterRequest) {
        inboxError = error.message || String(error);
        remoteHits = [];
      }
    }
  }

  function scheduleFilter(key) {
    lastSearchKey = key;
    filterRequest += 1;
    browseRequest += 1;
    browseBusy = !isHitMode();
    remoteHits = null;
    document.querySelector('.dw-main')?.scrollTo({ top: 0 });
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      writeInboxUrl();
      void runRemoteFilter();
    }, 150);
  }

  $: searchKey = [
    searchQuery,
    libraryView,
    selectedTags.join('\t'),
    noteFilter,
    filterYear,
    filterMonth,
    since,
    until,
    sortChoice,
    modeChoice,
    starredOnly ? '1' : '',
  ].join('\0');
  $: if (indexReady && searchKey !== lastSearchKey) scheduleFilter(searchKey);
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
  $: newestDatedYear = yearCounts[0]?.year || groups.find(group => group.year)?.year;
  $: browseItems = groups.filter(group => {
    if (libraryView === 'unfiled' || libraryView === 'holding') return group.key === libraryView;
    if (filterYear) return group.year === filterYear && (!filterMonth || group.month === filterMonth);
    if (libraryView === 'all') return true;
    return group.year === newestDatedYear;
  }).flatMap(group => group.items).sort((a, b) => {
    const order = (b.day || displayName(b.jsonFile)).localeCompare(a.day || displayName(a.jsonFile)) || b.jsonFile.localeCompare(a.jsonFile);
    return effectiveSort(searchKey) === 'oldest' ? -order : order;
  });
  $: visibleItems = showHits ? remoteHits || [] : browseItems;
  $: statusLine = showHits
    ? remoteHits == null ? 'Searching…' : remoteHits.length + (remoteHits.length === 50 ? ' matches shown · first 50' : ' matching notes')
    : browseBusy ? 'Loading notes…' : (filterYear ? 'Browsing ' + filterYear + (filterMonth ? ' · ' + MONTHS[Number(filterMonth) - 1] : '') : libraryView === 'all' ? 'All notes' : libraryView === 'unfiled' ? 'Unfiled' : libraryView === 'holding' ? 'Holding' : 'Recent · ' + (newestDatedYear || '')) + ' · ' + browseItems.length + ' notes';

  function jumpYear(year, month = '') {
    libraryView = 'all';
    filterYear = year;
    filterMonth = month;
  }

  function chooseLibrary(view) {
    clearFilters();
    sortChoice = '';
    libraryView = view;
    if (view === 'starred') { libraryView = 'all'; starredOnly = true; }
  }

  function applyNote(data) {
    if (!data?.jsonFile) return data;
    const i = transcriptions.findIndex((note) => note.jsonFile === data.jsonFile);
    if (i >= 0) {
      transcriptions[i] = data;
      transcriptions = transcriptions;
    } else {
      transcriptions = [...transcriptions, data];
    }
    if (remoteHits) {
      const hi = remoteHits.findIndex((note) => note.jsonFile === data.jsonFile);
      if (hi >= 0) {
        remoteHits[hi] = { ...remoteHits[hi], ...data, day: remoteHits[hi].day || data.day };
        remoteHits = remoteHits;
      }
    }
    return data;
  }

  async function hydrateNote(jsonFile) {
    const response = await fetch(`/note?file=${encodeURIComponent(jsonFile)}&_=${Date.now()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'failed to load note');
    return applyNote(data);
  }

  async function toggleExpanded(jsonFile) {
    if (!expanded[jsonFile]) {
      try {
        await hydrateNote(jsonFile);
      } catch (error) {
        console.error(error);
        return;
      }
      const hit = (remoteHits || []).find((note) => note.jsonFile === jsonFile);
      landCue = hit?.cue ?? landCue;
    } else {
      landCue = null;
    }
    expanded[jsonFile] = !expanded[jsonFile];
    expanded = expanded;
    writeInboxUrl();
  }


  async function withNoteBusy(jsonFile, work) {
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
    await withNoteBusy(jsonFile, async () => {
      await postJson('/holding/resolve', { file: jsonFile, action });
    });
  }

  function deleteTranscription(jsonFile) {
    if (confirm('Are you sure you want to delete this transcription?')) {
      transcriptions = transcriptions.filter((transcription) => transcription.jsonFile !== jsonFile);
      if (remoteHits) remoteHits = remoteHits.filter((note) => note.jsonFile !== jsonFile);
      socket.emit('delete-transcription', { jsonFile });
    }
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
      const data = await postJson('/note', { file: jsonFile, tags });
      applyNote(data);
      await loadMeta();
      if (isHitMode()) await runRemoteFilter();
    });
  }

  function onAudioTime(item, event) {
    item.transcriptionJson._currentTime = event.currentTarget.currentTime;
    transcriptions = transcriptions;
    if (remoteHits) remoteHits = remoteHits;
  }

  function clearSearch() {
    searchQuery = '';
  }

  function clearFilters() {
    selectedTags = [];
    libraryView = 'recent';
    filterYear = '';
    filterMonth = '';
    since = '';
    until = '';
    starredOnly = false;
    noteFilter = 'all';
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
      void (isHitMode() ? runRemoteFilter() : loadBrowse()).catch((error) => {
        inboxError = error.message || String(error);
      });
      return;
    }
    if (data?.paged) {
      pagedIndex = true;
      mergeNotes(data.notes);
    } else if (data?.notes) {
      mergeNotes(data.notes, { replace: !pagedIndex });
    }
    const open = Object.keys(expanded).filter((key) => expanded[key]);
    for (const jsonFile of open) void hydrateNote(jsonFile);
    void loadMeta();
  }

  function onTranscription(data) {
    upsertNote(data);
    if (isHitMode()) scheduleFilter(searchKey);
    if (data?.jsonFile && expanded[data.jsonFile]) void hydrateNote(data.jsonFile);
  }

  function onPopState() {
    applyInboxUrl(location.search);
    lastSearchKey = '';
    if (indexReady) scheduleFilter(searchKey);
    const file = parseInboxUrl(location.search).file;
    if (file) void hydrateNote(file);
  }

  onMount(() => {
    applyInboxUrl(location.search);
    const pendingFile = parseInboxUrl(location.search).file;
    socket.on('notes-index', onNotesIndex);
    socket.on('transcription', onTranscription);
    window.addEventListener('popstate', onPopState);
    void loadBrowse()
      .catch((error) => {
        if (!transcriptions.length) inboxError = error.message || String(error);
      })
      .then(async () => {
        if (pendingFile) {
          try {
            await hydrateNote(pendingFile);
            expanded[pendingFile] = true;
            expanded = expanded;
          } catch (error) {
            inboxError = error.message || String(error);
          }
        }
      })
      .finally(() => {
        indexReady = true;
      });
    return () => {
      socket.off('notes-index', onNotesIndex);
      socket.off('transcription', onTranscription);
      window.removeEventListener('popstate', onPopState);
      clearTimeout(searchTimer);
      filterRequest += 1;
      browseRequest += 1;
    };
  });
</script>

<section class="transcriptions">
  <aside class="library dw-card" class:is-open={navigationOpen} aria-label="Library navigation">
    <button type="button" class="dw-btn-secondary dw-btn-compact navigation-toggle" aria-expanded={navigationOpen} on:click={() => (navigationOpen = !navigationOpen)}>Library & dates</button>
    <div class="library-body">
      <p class="dw-eyebrow">Library</p>
      <nav class="library-links" aria-label="Library views">
        <button class:is-active={libraryView === 'recent' && !filterYear && !showHits} on:click={() => chooseLibrary('recent')}>Recent</button>
        <button class:is-active={(libraryView === 'all' || (libraryView === 'recent' && showHits)) && !filterYear && !starredOnly} on:click={() => chooseLibrary('all')}>All notes</button>
        <button class:is-active={starredOnly} on:click={() => chooseLibrary('starred')}>★ Starred <span>{journalMeta?.starred || 0}</span></button>
        <button class:is-active={libraryView === 'unfiled'} on:click={() => chooseLibrary('unfiled')}>Unfiled</button>
        <button class:is-active={libraryView === 'holding'} on:click={() => chooseLibrary('holding')}>Holding</button>
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
      <details class="tag-management"><summary>Manage tags</summary>
      <div class="tag-cloud-more">
        <label class="model-toggle">
          <input type="checkbox" bind:checked={useModelForTags} disabled={consolidateBusy || applyBusy} />
          Ask model for synonyms
        </label>
        <button
          type="button"
          class="dw-btn-secondary dw-btn-compact"
          disabled={consolidateBusy || applyBusy}
          on:click={previewConsolidate}
        >
          {consolidateBusy ? consolidatePhase || 'Reviewing tags…' : 'Consolidate similar tags'}
        </button>
      </div>
      {#if consolidateError}
        <p class="dw-error">{consolidateError}</p>
      {/if}
      {#if applyResult}
        <p class="dw-muted">
          Merged tags on {applyResult.filesChanged} notes
          ({applyResult.uniqueBefore} → {applyResult.uniqueAfter} unique).
        </p>
      {/if}
      {#if consolidatePlan}
        <div class="dw-card consolidate">
          <div class="consolidate-head">
            <strong>
              {consolidatePlan.groups.length
                ? `${consolidatePlan.groups.length} merge${consolidatePlan.groups.length === 1 ? '' : 's'} from ${consolidatePlan.unique} tags`
                : `No close duplicates in ${consolidatePlan.unique} tags`}
            </strong>
            {#if consolidatePhase}
              <span class="dw-muted">{consolidatePhase}</span>
            {:else if consolidatePlan.modelError}
              <span class="dw-muted">Model skipped: {consolidatePlan.modelError}</span>
            {:else if consolidatePlan.modelUsed}
              <span class="dw-muted">Includes model suggestions</span>
            {:else}
              <span class="dw-muted">Spelling pass only</span>
            {/if}
          </div>
          {#if consolidatePlan.groups.length}
            <ul class="consolidate-list">
              {#each consolidatePlan.groups as group, index}
                <li>
                  <label>
                    <input type="checkbox" bind:checked={consolidateSelected[index]} />
                    <span>
                      <strong>{group.keep}</strong>
                      <span class="dw-chip-count">{group.counts?.[group.keep] || ''}</span>
                      ←
                      {group.drop
                        .map((tag) => `${tag}${group.counts?.[tag] ? ` (${group.counts[tag]})` : ''}`)
                        .join(', ')}
                      <em>{reasonLabel(group.reason)}</em>
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
            <div class="tag-cloud-more">
              <button type="button" class="dw-btn-primary dw-btn-compact" disabled={applyBusy} on:click={applyConsolidate}>
                {applyBusy
                  ? 'Applying…'
                  : `Apply ${selectedConsolidateGroups().length} merge${selectedConsolidateGroups().length === 1 ? '' : 's'}`}
              </button>
              <button type="button" class="dw-btn-secondary dw-btn-compact" disabled={applyBusy} on:click={dismissConsolidate}>
                Cancel
              </button>
            </div>
          {:else}
            <div class="tag-cloud-more">
              <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={dismissConsolidate}>Dismiss</button>
            </div>
          {/if}
        </div>
      {/if}
      </details>
    </details>
  {/if}
      <p class="dw-eyebrow date-heading">Dates</p>
      <nav class="date-nav" aria-label="Browse by date">
        {#each yearCounts as row}
          <details open={filterYear === row.year}>
            <summary><button type="button" class="year-select" class:is-active={filterYear === row.year} on:click={(event) => { event.preventDefault(); jumpYear(row.year); }}>{row.year}</button><span class="dw-chip-count">{row.count}</span></summary>
            <button class:is-active={filterYear === row.year && !filterMonth} on:click={() => jumpYear(row.year)}>All of {row.year}</button>
            {#each MONTHS as month, index}
              <button class:is-active={filterYear === row.year && filterMonth === String(index + 1).padStart(2, '0')} on:click={() => jumpYear(row.year, String(index + 1).padStart(2, '0'))}>{month}</button>
            {/each}
          </details>
        {/each}
      </nav>



    </div>
  </aside>
  <div class="results-column">
    <div class="dw-card search-card">
      <div class="search">
        <input class="dw-input" type="search" bind:value={searchQuery} placeholder="Search notes, tags, filenames…" aria-label="Search notes" />
        {#if searchQuery}<button class="dw-text-btn" on:click={clearSearch}>Clear search</button>{/if}
      </div>
      <div class="results-toolbar">
        <p class="dw-muted status-line" role="status">{statusLine}</p>
        <button class="dw-chip" class:is-active={starredOnly} aria-pressed={starredOnly} on:click={() => (starredOnly = !starredOnly)}>★ Starred</button>
        <button class="dw-btn-secondary dw-btn-compact" aria-expanded={filtersOpen} aria-controls="note-filters" on:click={() => (filtersOpen = !filtersOpen)}>Filters</button>
        <label class="sort-label">Sort
          <select class="dw-input dw-select" value={effectiveSort(searchKey)} on:change={event => (sortChoice = event.target.value)}>
            <option value="recent">Newest first</option><option value="oldest">Oldest first</option>
            {#if searchQuery.trim()}<option value="relevance">Best match</option>{/if}
          </select>
        </label>
      </div>
      {#if filterYear || selectedTags.length || since || until || starredOnly || noteFilter === 'unreadable' || libraryView === 'unfiled' || libraryView === 'holding'}
        <div class="active-filters" aria-label="Active filters">
          {#if filterYear}<button class="dw-chip is-active" aria-label="Remove date filter" on:click={() => { filterYear = ''; filterMonth = ''; }}>{filterYear}{filterMonth ? ' · ' + MONTHS[Number(filterMonth) - 1] : ''} ×</button>{/if}
          {#each selectedTags as tag}<button class="dw-chip is-active" aria-label={'Remove tag ' + tag} on:click={() => toggleTag(tag)}>{tag} ×</button>{/each}
          {#if since}<button class="dw-chip is-active" on:click={() => (since = '')}>From {since} ×</button>{/if}
          {#if until}<button class="dw-chip is-active" on:click={() => (until = '')}>To {until} ×</button>{/if}
          {#if starredOnly}<button class="dw-chip is-active" on:click={() => (starredOnly = false)}>Starred ×</button>{/if}
          {#if noteFilter === 'unreadable'}<button class="dw-chip is-active" on:click={() => (noteFilter = 'all')}>Unreadable ×</button>{/if}
          {#if libraryView === 'unfiled' || libraryView === 'holding'}<button class="dw-chip is-active" on:click={() => (libraryView = 'all')}>{libraryView} ×</button>{/if}
          <button class="dw-text-btn" on:click={clearFilters}>Clear filters</button>
        </div>
      {/if}
      {#if filtersOpen}
        <div class="filter-row" id="note-filters">
          <label class="filter-field">Year<select class="dw-input dw-select" bind:value={filterYear} on:change={() => { filterMonth = ''; libraryView = 'all'; }}><option value="">All years</option>{#each yearCounts as row}<option value={row.year}>{row.year}</option>{/each}</select></label>
          <label class="filter-field">Month<select class="dw-input dw-select" bind:value={filterMonth} disabled={!filterYear}><option value="">All months</option>{#each MONTHS as month, index}<option value={String(index + 1).padStart(2, '0')}>{month}</option>{/each}</select></label>
          <label class="filter-field">From<input class="dw-input dw-select" type="date" bind:value={since} /></label>
          <label class="filter-field">To<input class="dw-input dw-select" type="date" bind:value={until} /></label>
          {#if hasEmbeddings()}<label class="filter-field">Search mode<select class="dw-input dw-select" value={effectiveMode()} on:change={event => (modeChoice = event.target.value)}><option value="lex">Words</option><option value="hybrid">Hybrid</option></select></label>{/if}
        </div>
      {/if}
    </div>
    {#if inboxError}<p class="dw-error" role="alert">{inboxError}</p>{/if}
    {#if (showHits && remoteHits == null) || (!showHits && (browseBusy || !indexReady))}
      <p class="dw-empty">{showHits ? 'Searching…' : 'Loading notes…'}</p>
    {:else if !visibleItems.length}
      <p class="dw-empty">{indexing ? 'Indexing notes…' : 'No notes match this view.'} {#if searchQuery || filterYear || selectedTags.length || starredOnly}<button class="dw-text-btn" on:click={() => { clearSearch(); clearFilters(); }}>Reset search and filters</button>{/if}</p>
    {:else}
      <section class="notes" aria-label={showHits ? 'Matching notes' : 'Journal entries'}>
                  <NoteList
            items={visibleItems}
            variant={showHits ? 'hit' : 'note'}
            query={searchQuery}
            {selectedTags}
            {expanded}
            {showRaw}
            {noteBusy}
            landFile={Object.keys(expanded).find((key) => expanded[key]) || ''}
            {landCue}
            on:toggle={(event) => toggleExpanded(event.detail)}
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
  </div>
</section>

<style lang="scss">
  .transcriptions { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: 1.25rem; align-items: start; }
  .library { position: sticky; top: 0; padding: 1rem; max-height: calc(100dvh - 6rem); overflow-y: auto; box-shadow: none; }
  .library-body { display: flex; flex-direction: column; gap: 0.65rem; }
  .library-links { display: flex; flex-direction: column; gap: 0.2rem; }
  .library-links button, .date-nav button { display: flex; align-items: center; justify-content: space-between; width: 100%; border: 0; border-radius: 0.5rem; padding: 0.5rem 0.65rem; background: transparent; color: var(--dw-text-muted); font: inherit; font-size: 0.875rem; cursor: pointer; text-align: left; }
  .library-links button:hover, .date-nav button:hover { background: var(--dw-bg-hover); color: var(--dw-text); }
  .library-links button.is-active, .date-nav button.is-active { background: rgb(245 158 11 / 0.12); color: var(--dw-accent-bright); }
  .library-links button span { font-size: 0.75rem; }
  .date-heading { margin-top: 0.6rem; }
  summary { cursor: pointer; padding: 0.5rem 0; color: var(--dw-text); font-size: 0.875rem; }
  .date-nav summary span:last-child { float: right; }
  .date-nav .year-select { display: inline-flex; width: auto; padding: 0.1rem 0.35rem; font-weight: 600; }
  .date-nav button { padding-left: 1.1rem; font-size: 0.8125rem; }
  .tags-card { border-top: 1px solid var(--dw-border); padding-top: 0.35rem; }
  .tag-search { margin: 0.25rem 0 0.65rem; padding: 0.45rem 0.6rem; font-size: 0.8125rem; }
  .tags-head { display: none; }
  .tags-filter { display: none; }
  .tag-cloud-body, .tag-cloud-more { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tag-cloud-body { max-height: 20rem; overflow-y: auto; }
  .tag-cloud-body .dw-chip { max-width: 100%; overflow-wrap: anywhere; text-align: left; white-space: normal; }
  .tag-cloud-more { margin-top: 0.65rem; }
  .tag-management { margin-top: 0.65rem; border-top: 1px solid var(--dw-border); }
  .results-column { min-width: 0; }
  .search-card { padding: 0.85rem 1rem; margin-bottom: 0.85rem; box-shadow: none; }
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
  .navigation-toggle { display: none; }
  .notes { display: flex; flex-direction: column; gap: 0.5rem; }
  .dw-error { margin-bottom: 0.75rem; }
    .model-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: rgb(161 161 170);
  }

  .model-toggle input {
    accent-color: var(--dw-accent);
  }

  .consolidate {
    margin-top: 0.7rem;
    padding: 0.7rem 0.8rem;
  }

  .consolidate-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: baseline;
    margin-bottom: 0.45rem;
  }

  .consolidate-list {
    margin: 0 0 0.55rem;
    padding: 0;
    list-style: none;
    max-height: 16rem;
    overflow: auto;
  }

  .consolidate-list li {
    margin: 0.25rem 0;
  }

  .consolidate-list label {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .consolidate-list input {
    accent-color: var(--dw-accent);
    margin-top: 0.15rem;
  }

  .consolidate-list em {
    color: rgb(161 161 170);
    font-style: normal;
    margin-left: 0.35rem;
  }


  @media (max-width: 800px) {
    .transcriptions { grid-template-columns: minmax(0, 1fr); gap: 0.75rem; }
    .library { position: static; padding: 0.65rem; max-height: none; }
    .navigation-toggle { display: inline-flex; }
    .library:not(.is-open) .library-body { display: none; }
    .library-body { margin-top: 0.75rem; max-height: 45dvh; overflow-y: auto; }
    .status-line { flex-basis: 100%; }
    .search-card { padding: 0.75rem; }
    .search { flex-wrap: wrap; }
  }
  @media (min-width: 801px) {
    .search-card { position: sticky; top: 0; z-index: 5; background: rgb(24 24 27 / 0.96); }
  }
</style>
