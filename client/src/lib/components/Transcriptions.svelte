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
  let yearOpen = {};
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
  let loadedYears = {};
  let noteBusy = {};
  let journalMeta = null;
  let applyingUrl = false;
  let datesOpen = false;
  const TAG_CLOUD_CAP = 40;

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

  function markLoadedYears(notes) {
    for (const note of notes || []) {
      const folder = folderOf(note.jsonFile);
      if (folder.year) loadedYears[folder.year] = true;
    }
    loadedYears = loadedYears;
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
    return Number(journalMeta?.embedded || 0) > 0;
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
    const params = new URLSearchParams();
    if (!isHitMode() && filterYear) {
      params.set('year', filterYear);
      if (filterMonth) params.set('month', filterMonth);
    }
    const qs = params.toString();
    const data = await fetchJson(qs ? `/notes/index?${qs}` : '/notes/index');
    pagedIndex = Boolean(data.paged);
    indexing = Boolean(data.indexing);
    mergeNotes(data.notes, { replace: true });
    markLoadedYears(data.notes);
    lastBrowseKey = `${!isHitMode() && filterYear ? filterYear : ''}|${!isHitMode() && filterMonth ? filterMonth : ''}`;
    await loadMeta();
  }

  async function ensureYearLoaded(year) {
    if (!year || !pagedIndex || loadedYears[year]) return;
    const data = await fetchJson(`/notes/index?year=${encodeURIComponent(year)}`);
    mergeNotes(data.notes);
    loadedYears[year] = true;
    loadedYears = loadedYears;
  }

  async function runRemoteFilter() {
    if (!isHitMode()) {
      remoteHits = null;
      const browseKey = `${filterYear}|${filterMonth}`;
      if (browseKey !== lastBrowseKey) {
        lastBrowseKey = browseKey;
        try {
          await loadBrowse();
        } catch (error) {
          inboxError = error.message || String(error);
        }
      }
      if (filterYear) {
        yearOpen[filterYear] = true;
        yearOpen = yearOpen;
      }
      return;
    }
    try {
      remoteHits = null;
      const params = new URLSearchParams();
      const q = searchQuery.trim();
      if (q) params.set('q', q);
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
      remoteHits = tightenFilenameHits(q, (data.hits || data.notes || []).map(noteFromHit));
    } catch (error) {
      inboxError = error.message || String(error);
    }
  }

  function scheduleFilter(key) {
    lastSearchKey = key;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      writeInboxUrl();
      void runRemoteFilter();
    }, 150);
  }

  $: searchKey = [
    searchQuery,
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
  $: showHits = Boolean(
    searchQuery.trim() ||
      since ||
      until ||
      starredOnly ||
      selectedTags.length ||
      noteFilter === 'unreadable'
  );
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
    const pool = showSingletons ? tagCloud : frequentTags;
    const capped = showAllFrequent ? pool : pool.slice(0, TAG_CLOUD_CAP);
    const extraSelected = tagCloud.filter(
      (item) => selectedTags.includes(item.tag) && !capped.some((shown) => shown.tag === item.tag)
    );
    return [...capped, ...extraSelected];
  })();
  let monthPage = 1;
  $: specialGroups = groups.filter((group) => group.key === 'holding' || group.key === 'unfiled');
  $: datedGroups = groups.filter((group) => group.key !== 'holding' && group.key !== 'unfiled');
  $: pagedGroups = showHits ? groups : [...specialGroups, ...datedGroups.slice(0, monthPage)];
  $: hiddenMonths = showHits ? 0 : Math.max(0, datedGroups.length - monthPage);
  $: newestDatedYear = datedGroups[0]?.year;
  $: yearSections = nestByYear(groups);
  $: datedYearCount = yearSections.filter((section) => section.kind === 'year').length;
  $: pagedKeys = new Set(pagedGroups.map((group) => group.key));
  let pagedYearInit = false;
  $: if (!pagedYearInit && newestDatedYear) {
    pagedYearInit = true;
    pageThroughYear(newestDatedYear);
  }
  $: newestYearCount = yearCounts.find((row) => row.year === (filterYear || newestDatedYear))?.count || 0;
  $: statusLine = showHits
    ? remoteHits == null
      ? 'Searching…'
      : `${remoteHits.length} hit${remoteHits.length === 1 ? '' : 's'}`
    : filterYear
      ? `Browsing ${filterYear}${filterMonth ? ` · ${MONTHS[Number(filterMonth) - 1] || filterMonth}` : ''} · ${newestYearCount} notes`
      : `Showing newest year · ${newestYearCount} notes`;

  function nestByYear(monthGroups) {
    const sections = [];
    const yearMap = new Map();
    for (const group of monthGroups) {
      if (group.key === 'holding' || group.key === 'unfiled' || group.key === 'other') {
        sections.push({
          kind: 'special',
          key: group.key,
          label: groupLabel(group),
          months: [group],
          count: group.items.length,
        });
        continue;
      }
      if (!yearMap.has(group.year)) {
        const section = {
          kind: 'year',
          key: group.year,
          label: group.year,
          months: [],
          count: 0,
        };
        yearMap.set(group.year, section);
        sections.push(section);
      }
      const section = yearMap.get(group.year);
      section.months.push(group);
      section.count += group.items.length;
    }
    for (const row of yearCounts) {
      if (yearMap.has(row.year)) {
        const section = yearMap.get(row.year);
        if (section.count < row.count) section.count = row.count;
        continue;
      }
      const section = {
        kind: 'year',
        key: row.year,
        label: row.year,
        months: [],
        count: row.count,
      };
      yearMap.set(row.year, section);
      sections.push(section);
    }
    const specials = sections.filter((section) => section.kind === 'special');
    const years = sections.filter((section) => section.kind === 'year').sort((a, b) => b.key.localeCompare(a.key));
    return [...specials, ...years];
  }

  function defaultYearOpen(key, kind) {
    if (kind === 'special') return true;
    if (filterYear) return key === filterYear;
    const currentYear = String(new Date().getFullYear());
    return key === currentYear || key === newestDatedYear;
  }

  function isYearOpen(section) {
    if (Object.prototype.hasOwnProperty.call(yearOpen, section.key)) return yearOpen[section.key];
    return defaultYearOpen(section.key, section.kind);
  }

  function monthsToShow(section) {
    if (showHits || filterYear) return section.months;
    return section.months.filter((group) => pagedKeys.has(group.key));
  }

  function pageThroughYear(year) {
    if (!year) return;
    let lastIndex = -1;
    for (let i = 0; i < datedGroups.length; i++) {
      if (datedGroups[i].year === year) lastIndex = i;
    }
    if (lastIndex >= 0 && monthPage < lastIndex + 1) monthPage = lastIndex + 1;
  }

  function toggleYear(section) {
    const nextOpen = !isYearOpen(section);
    yearOpen[section.key] = nextOpen;
    yearOpen = yearOpen;
    if (nextOpen && section.kind === 'year') {
      pageThroughYear(section.key);
      void ensureYearLoaded(section.key).catch((error) => {
        inboxError = error.message || String(error);
      });
    }
  }

  function jumpYear(year) {
    filterYear = year;
    filterMonth = '';
    if (!searchQuery.trim() && !since && !until) {
      yearOpen[year] = true;
      yearOpen = yearOpen;
      void ensureYearLoaded(year).then(() => loadBrowse()).catch((error) => {
        inboxError = error.message || String(error);
      });
    }
  }

  function focusRecentYears() {
    const currentYear = String(new Date().getFullYear());
    const next = {};
    for (const section of yearSections) {
      next[section.key] =
        section.kind === 'special' || section.key === currentYear || section.key === newestDatedYear;
    }
    yearOpen = next;
  }

  async function expandAllYears() {
    if (pagedIndex) {
      try {
        const data = await fetchJson('/notes/index?all=1');
        mergeNotes(data.notes);
        markLoadedYears(data.notes);
      } catch (error) {
        inboxError = error.message || String(error);
      }
    }
    const next = {};
    for (const section of yearSections) next[section.key] = true;
    yearOpen = next;
    if (datedGroups.length) monthPage = datedGroups.length;
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

  function lazyMore(node, remaining) {
    const bump = (left) => {
      if (left > 0) monthPage += 1;
    };
    const root = node.closest('.dw-main');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) bump(remaining);
      },
      { root: root || null, rootMargin: '800px' }
    );
    observer.observe(node);
    return {
      update(left) {
        remaining = left;
        const top = node.getBoundingClientRect().top;
        const limit = (root?.clientHeight || window.innerHeight) + 800;
        if (left > 0 && top < limit) bump(left);
      },
      destroy() {
        observer.disconnect();
      },
    };
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
    });
  }

  async function saveTags(jsonFile, tags) {
    await withNoteBusy(jsonFile, async () => {
      const data = await postJson('/note', { file: jsonFile, tags });
      applyNote(data);
      await loadMeta();
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
      void loadBrowse().catch((error) => {
        inboxError = error.message || String(error);
      });
      return;
    }
    if (data?.paged) {
      pagedIndex = true;
      mergeNotes(data.notes);
      markLoadedYears(data.notes);
    } else if (data?.notes) {
      mergeNotes(data.notes, { replace: !pagedIndex });
      markLoadedYears(data.notes);
    }
    const open = Object.keys(expanded).filter((key) => expanded[key]);
    for (const jsonFile of open) void hydrateNote(jsonFile);
    void loadMeta();
  }

  function onTranscription(data) {
    upsertNote(data);
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
    };
  });
</script>

<section class="transcriptions">
  <div class="dw-card search-card">
    <div class="search">
      <span class="search-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </span>
      <input
        class="dw-input"
        type="search"
        bind:value={searchQuery}
        placeholder="Search notes, tags, filenames…"
        aria-label="Search notes"
      />
      {#if searchQuery}
        <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={clearSearch}>Clear search</button>
      {/if}
    </div>

    <div class="filters">
      <p class="dw-eyebrow">Filters</p>
      <div class="filter-row">
        <label class="filter-field">
          <span>Year</span>
          <select class="dw-input dw-select" bind:value={filterYear} on:change={() => (filterMonth = filterYear ? filterMonth : '')}>
            <option value="">All years</option>
            {#each yearCounts as row}
              <option value={row.year}>{row.year} · {row.count}</option>
            {/each}
          </select>
        </label>
        <label class="filter-field">
          <span>Month</span>
          <select class="dw-input dw-select" bind:value={filterMonth} disabled={!filterYear}>
            <option value="">All months</option>
            {#each MONTHS as name, index}
              <option value={String(index + 1).padStart(2, '0')}>{name}</option>
            {/each}
          </select>
        </label>
        <div class="dates" class:is-open={datesOpen}>
          <button type="button" class="dw-text-btn dates-toggle" on:click={() => (datesOpen = !datesOpen)}>
            Dates
          </button>
          <label class="filter-field">
            <span>From</span>
            <input class="dw-input dw-select" type="date" bind:value={since} />
          </label>
          <label class="filter-field">
            <span>To</span>
            <input class="dw-input dw-select" type="date" bind:value={until} />
          </label>
        </div>
        <div class="dw-segmented" role="group" aria-label="Sort">
          <button type="button" class:is-on={effectiveSort() === 'recent'} on:click={() => (sortChoice = 'recent')}>Recent</button>
          <button type="button" class:is-on={effectiveSort() === 'oldest'} on:click={() => (sortChoice = 'oldest')}>Oldest</button>
          <button type="button" class:is-on={effectiveSort() === 'relevance'} on:click={() => (sortChoice = 'relevance')}>
            Best match
          </button>
        </div>
        {#if hasEmbeddings()}
          <div class="dw-segmented" role="group" aria-label="Search mode">
            <button type="button" class:is-on={effectiveMode() === 'lex'} on:click={() => (modeChoice = 'lex')}>Words</button>
            <button type="button" class:is-on={effectiveMode() === 'hybrid'} on:click={() => (modeChoice = 'hybrid')}>
              Hybrid
            </button>
          </div>
        {/if}
        <button
          type="button"
          class="dw-chip"
          class:is-active={starredOnly}
          on:click={() => (starredOnly = !starredOnly)}
        >
          Starred
          {#if journalMeta?.starred}
            <span class="dw-chip-count">{journalMeta.starred}</span>
          {/if}
        </button>
        {#if noteFilter === 'unreadable'}
          <button type="button" class="dw-chip is-active" on:click={() => (noteFilter = 'all')}>Unreadable</button>
        {/if}
        {#if selectedTags.length || filterYear || since || until || starredOnly || noteFilter === 'unreadable'}
          <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={clearFilters}>Clear filters</button>
        {/if}
      </div>
    </div>
    <p class="dw-muted status-line">{statusLine}</p>
  </div>

  {#if inboxError}
    <p class="dw-error">{inboxError}</p>
  {/if}

  {#if !transcriptions.length && !indexReady}
    <p class="dw-empty">Loading notes…</p>
  {:else if !transcriptions.length && indexing}
    <p class="dw-empty">Indexing notes…</p>
  {:else if !transcriptions.length}
    <p class="dw-empty">No notes yet. Record or drop a file above.</p>
  {/if}

  {#if tagCloud.length}
    <section class="dw-card tags-card">
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
    </section>
  {/if}

  {#if showHits}
    <section class="hits" aria-label="Search hits">
      {#if remoteHits == null}
        <p class="dw-empty">Searching…</p>
      {:else if !remoteHits.length}
        <p class="dw-empty">
          No notes matched
          {#if searchQuery.trim()}
            “{searchQuery.trim()}”
          {/if}.
        </p>
      {:else}
        <div class="notes">
          <NoteList
            items={remoteHits}
            variant="hit"
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
        </div>
      {/if}
    </section>
  {/if}

  {#if yearCounts.length}
    <div class="years-strip">
      <p class="dw-eyebrow">Years</p>
      <div class="year-jump">
        {#each yearCounts as row}
          <button
            type="button"
            class="dw-text-btn"
            class:dw-text-btn-accent={filterYear === row.year}
            on:click={() => jumpYear(row.year)}
          >
            {row.year}
            <span class="dw-chip-count">{row.count}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if !showHits && datedYearCount > 1}
    <div class="archive-tools">
      <p class="dw-eyebrow">Notes</p>
      <div>
        <button type="button" class="dw-text-btn dw-text-btn-accent" on:click={focusRecentYears}>Focus</button>
        <button type="button" class="dw-text-btn" on:click={expandAllYears}>All years</button>
      </div>
    </div>
  {/if}

  {#if !showHits}
  <div class="archive">
    {#each yearSections as section (section.key)}
      <section class="year-block">
        <button
          type="button"
          class="year-head"
          aria-expanded={isYearOpen(section)}
          on:click={() => toggleYear(section)}
        >
          <svg class="chevron" class:is-closed={!isYearOpen(section)} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <span class="year-label">{section.label}</span>
          <span class="year-count">{section.count} note{section.count === 1 ? '' : 's'}</span>
        </button>
        {#if isYearOpen(section)}
          <div class="year-body">
            {#each monthsToShow(section) as group (group.key)}
              <div class="month-block">
                {#if section.kind === 'year'}
                  <div class="month-rail">
                    <span>{groupLabel(group)}</span>
                    <span>{group.items.length}</span>
                  </div>
                {/if}
                <div class="notes">
                  <NoteList
                    items={group.items}
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
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
    {#if hiddenMonths > 0}
      <p class="dw-muted load-more" use:lazyMore={hiddenMonths}>
        {hiddenMonths} older month{hiddenMonths === 1 ? '' : 's'} — scroll to load
      </p>
    {/if}
  </div>
  {/if}
</section>

<style lang="scss">
  .transcriptions {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    margin-top: 0.85rem;
  }

  .search-card,
  .tags-card {
    padding: 0.85rem;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    position: relative;
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    width: 1.0625rem;
    height: 1.0625rem;
    color: rgb(251 191 36 / 0.7);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .search-icon svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .search .dw-input {
    padding-left: 2.4rem;
  }

  .filters {
    margin-top: 0.75rem;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.45rem 0.55rem;
    margin-top: 0.4rem;
  }

  .filter-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgb(113 113 122);
  }

  .dw-select {
    width: auto;
    min-width: 8.5rem;
    padding: 0.4rem 0.65rem;
    font-size: 0.8125rem;
    letter-spacing: 0;
    text-transform: none;
    font-weight: 500;
  }

  .dates {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.45rem;
  }

  .dates-toggle {
    display: none;
  }

  .status-line {
    margin-top: 0.65rem;
    font-variant-numeric: tabular-nums;
  }

  .tags-head,
  .tags-filter,
  .archive-tools,
  .years-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem 0.75rem;
    margin-bottom: 0.55rem;
  }

  .year-jump {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
  }

  .tag-cloud-body {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tag-cloud-more {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.65rem;
  }

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

  .hits .notes {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .year-block {
    overflow: hidden;
    border-radius: 0.75rem;
    border: 1px solid rgb(255 255 255 / 0.06);
    background: rgb(0 0 0 / 0.15);
  }

  .year-block + .year-block {
    margin-top: 0.55rem;
  }

  .year-head {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.5rem;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0.65rem 0.85rem;
    text-align: left;
  }

  .year-head:hover {
    background: rgb(255 255 255 / 0.04);
  }

  .chevron {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    color: rgb(113 113 122);
    transition: transform 0.2s ease;
  }

  .chevron.is-closed {
    transform: rotate(-90deg);
  }

  .year-label {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .year-count {
    margin-left: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: rgb(113 113 122);
  }

  .year-body {
    border-top: 1px solid rgb(255 255 255 / 0.05);
    padding: 0.5rem 0.55rem 0.75rem;
  }

  .month-block + .month-block {
    margin-top: 0.75rem;
  }

  .month-rail {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    background: rgb(9 9 11 / 0.85);
    backdrop-filter: blur(8px);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgb(161 161 170);
  }

  .month-rail span:last-child {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    text-transform: none;
    color: rgb(82 82 91);
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .load-more {
    padding: 0.35rem 0.15rem 0.15rem;
  }

  @media (max-width: 720px) {
    .dates-toggle {
      display: inline-flex;
    }

    .dates:not(.is-open) .filter-field {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }
</style>
