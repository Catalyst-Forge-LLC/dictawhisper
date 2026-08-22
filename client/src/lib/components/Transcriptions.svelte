<script>
  import { onMount } from 'svelte';
  import Fuse from 'fuse.js';

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
  let inboxError = '';
  let indexReady = false;
  let noteBusy = {};
  const TAG_CLOUD_CAP = 40;
  const FUSE_OPTS = {
    keys: [
      { name: 'transcriptionJson.tags', weight: 2 },
      {
        name: 'searchBody',
        weight: 1.5,
        getFn: (item) =>
          item.transcriptionJson?.searchBody ||
          item.transcriptionJson?.cleanedTranscription ||
          item.transcriptionJson?.text ||
          item.transcriptionJson?.preview ||
          '',
      },
      {
        name: 'basename',
        weight: 1,
        getFn: (item) => item.basename || displayName(item.jsonFile),
      },
      {
        name: 'searchRaw',
        weight: 0.6,
        getFn: (item) => item.transcriptionJson?.searchRaw || item.transcriptionJson?.text || '',
      },
    ],
    useTokenSearch: true,
    ignoreLocation: true,
    threshold: 0.4,
  };

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

  function displayName(jsonFile) {
    return String(jsonFile || '').replace(/\\/g, '/').split('/').pop();
  }

  function tagsOf(item) {
    const tags = item.transcriptionJson?.tags;
    return Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  }

  function cleanedOf(item) {
    const json = item.transcriptionJson || {};
    if (json._partial) return json.hasCleaned ? String(json.preview || '').trim() : '';
    return String(json.cleanedTranscription || json.preview || '').trim();
  }

  function preview(text, limit = 200) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= limit) return oneLine;
    return `${oneLine.slice(0, limit)}…`;
  }

  function paragraphs(text) {
    return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  }

  function sectionsOf(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];
    const paras = paragraphs(trimmed);
    if (paras.length >= 2) return paras;
    const sentences = trimmed.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    return sentences.length >= 2 ? sentences : [trimmed];
  }

  function cuesOf(item) {
    const cues = item.transcriptionJson?.playbackCues;
    if (Array.isArray(cues) && cues.length) return cues;
    const cleaned = cleanedOf(item);
    return cleaned ? sectionsOf(cleaned).map((text) => ({ text, start: 0, end: 0 })) : [];
  }

  function audioUrl(jsonFile) {
    return `/audio?file=${encodeURIComponent(jsonFile)}`;
  }

  function cleanupLabel(json) {
    const row = json?.cleanup;
    if (!row || typeof row !== 'object') return '';
    const parts = [];
    if (row.createdAt) parts.push(String(row.createdAt).slice(0, 10));
    if (row.model) parts.push(row.model);
    if (row.host) parts.push(row.host);
    const earlier = Array.isArray(json.cleanupHistory) ? json.cleanupHistory.length : 0;
    if (earlier) parts.push(`${earlier} earlier`);
    return parts.join(' · ');
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }

  function cueHasTime(cue) {
    return typeof cue?.start === 'number' && Number.isFinite(cue.start);
  }

  function playCue(event, cue) {
    if (!cueHasTime(cue)) return;
    const article = event.currentTarget.closest('.note');
    const audio = article?.querySelector('audio');
    if (!audio) return;
    audio.currentTime = Math.max(0, Number(cue.start) || 0);
    audio.play();
  }

  function cueActive(item, cue, index) {
    if (!cueHasTime(cue)) return false;
    const current = item.transcriptionJson?._currentTime;
    if (typeof current !== 'number') return false;
    const next = cuesOf(item)[index + 1];
    const end = cue.end > cue.start ? cue.end : next ? next.start : Infinity;
    return current >= cue.start && current < end;
  }

  function onAudioTime(item, event) {
    item.transcriptionJson._currentTime = event.currentTarget.currentTime;
    transcriptions = transcriptions;
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

  $: fuseIndex = new Fuse(transcriptions, FUSE_OPTS);
  $: searched = searchQuery.trim()
    ? fuseIndex.search(searchQuery.trim()).map((result) => result.item)
    : transcriptions;
  function isUnreadable(item) {
    return Boolean(item.transcriptionJson?.audioError) || item.transcriptionJson?.preview === '[unreadable audio]';
  }

  $: visible = searched.filter((item) => {
    if (noteFilter === 'unreadable' && !isUnreadable(item)) return false;
    if (!selectedTags.length) return true;
    const have = new Set(tagsOf(item));
    return selectedTags.every((tag) => have.has(tag));
  });
  $: groups = groupTranscriptions(visible);
  $: tagCloud = buildTagCloud(transcriptions);
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
  $: pagedGroups = listIsFiltered()
    ? groups
    : [...specialGroups, ...datedGroups.slice(0, monthPage)];
  $: hiddenMonths = listIsFiltered() ? 0 : Math.max(0, datedGroups.length - monthPage);
  $: newestDatedYear = datedGroups[0]?.year;
  $: yearSections = nestByYear(groups);
  $: datedYearCount = yearSections.filter((section) => section.kind === 'year').length;
  $: pagedKeys = new Set(pagedGroups.map((group) => group.key));
  let pagedYearInit = false;
  $: if (!pagedYearInit && newestDatedYear) {
    pagedYearInit = true;
    pageThroughYear(newestDatedYear);
  }

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
    return sections;
  }

  function listIsFiltered() {
    return Boolean(selectedTags.length || searchQuery.trim() || noteFilter === 'unreadable');
  }

  function defaultYearOpen(key, kind) {
    if (kind === 'special') return true;
    if (listIsFiltered()) return true;
    const currentYear = String(new Date().getFullYear());
    return key === currentYear || key === newestDatedYear;
  }

  function isYearOpen(section) {
    if (listIsFiltered()) return true;
    if (Object.prototype.hasOwnProperty.call(yearOpen, section.key)) return yearOpen[section.key];
    return defaultYearOpen(section.key, section.kind);
  }

  function monthsToShow(section) {
    if (listIsFiltered()) return section.months;
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
    if (nextOpen && section.kind === 'year') pageThroughYear(section.key);
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

  function expandAllYears() {
    const next = {};
    for (const section of yearSections) next[section.key] = true;
    yearOpen = next;
    if (datedGroups.length) monthPage = datedGroups.length;
  }

  async function hydrateNote(jsonFile) {
    const response = await fetch(`/note?file=${encodeURIComponent(jsonFile)}&_=${Date.now()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'failed to load note');
    const i = transcriptions.findIndex((note) => note.jsonFile === jsonFile);
    if (i >= 0) {
      transcriptions[i] = data;
      transcriptions = transcriptions;
      return transcriptions[i];
    }
    transcriptions = [...transcriptions, data];
    return data;
  }

  async function toggleExpanded(jsonFile) {
    if (!expanded[jsonFile]) {
      try {
        await hydrateNote(jsonFile);
      } catch (error) {
        console.error(error);
        return;
      }
    }
    expanded[jsonFile] = !expanded[jsonFile];
    expanded = expanded;
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

  function isHolding(jsonFile) {
    return folderOf(jsonFile).key === 'holding';
  }

  function hasDateName(jsonFile) {
    return /^\d{4}-\d{2}-\d{2}/.test(displayName(jsonFile));
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
      socket.emit('delete-transcription', { jsonFile });
    }
  }

  async function copyTranscription(transcription) {
    try {
      const item = await hydrateNote(transcription.jsonFile);
      const json = item?.transcriptionJson || {};
      const fromCues = cuesOf(item)
        .map((cue) => String(cue.text || '').trim())
        .filter(Boolean);
      const text =
        (fromCues.length ? fromCues.join('\n\n') : '') ||
        sectionsOf(json.cleanedTranscription || '').join('\n\n') ||
        (json.segments || []).map((segment) => segment.text).join('\n\n') ||
        json.preview ||
        '';
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error(error);
    }
  }

  function upsertNote(data) {
    if (!data?.jsonFile) return;
    const i = transcriptions.findIndex((note) => note.jsonFile === data.jsonFile);
    if (i >= 0) {
      const current = transcriptions[i];
      if (data.transcriptionJson?._partial && current.transcriptionJson && !current.transcriptionJson._partial) {
        transcriptions[i] = {
          ...current,
          transcriptionJson: { ...current.transcriptionJson, tags: data.transcriptionJson.tags },
        };
      } else {
        transcriptions[i] = data;
      }
      transcriptions = transcriptions;
    } else {
      transcriptions = [...transcriptions, data];
    }
  }

  function applyIndex(notes) {
    const open = Object.keys(expanded).filter((key) => expanded[key]);
    transcriptions = notes || [];
    for (const jsonFile of open) void hydrateNote(jsonFile);
  }

  function onNotesIndex(data) {
    applyIndex(data?.notes);
  }

  function onTranscription(data) {
    upsertNote(data);
  }

  onMount(() => {
    socket.on('notes-index', onNotesIndex);
    socket.on('transcription', onTranscription);
    void fetch('/notes/index')
      .then((res) => {
        if (!res.ok) throw new Error(`index ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if ((data?.notes || []).length >= transcriptions.length) applyIndex(data.notes);
      })
      .catch((error) => {
        if (!transcriptions.length) inboxError = error.message || String(error);
      })
      .finally(() => {
        indexReady = true;
      });
    return () => {
      socket.off('notes-index', onNotesIndex);
      socket.off('transcription', onTranscription);
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
        <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => (searchQuery = '')}>
          Clear
        </button>
      {/if}
      {#if noteFilter === 'unreadable'}
        <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => (noteFilter = 'all')}>
          Unreadable
        </button>
      {/if}
    </div>
  </div>

  {#if inboxError}
    <p class="dw-error">{inboxError}</p>
  {/if}

  {#if !transcriptions.length && !indexReady}
    <p class="dw-empty">Loading notes…</p>
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
          <span class="dw-muted">
            {visible.length} note{visible.length === 1 ? '' : 's'} with {selectedTags.join(' + ')}
          </span>
          <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => (selectedTags = [])}>
            Clear filter
          </button>
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

  {#if transcriptions.length && !visible.length}
    <p class="dw-empty">
      No notes match
      {#if searchQuery.trim()}
        “{searchQuery.trim()}”
      {/if}
      {#if searchQuery.trim() && selectedTags.length}
        and
      {/if}
      {#if selectedTags.length}
        {selectedTags.join(' + ')}
      {/if}
      {#if noteFilter === 'unreadable' && !searchQuery.trim() && !selectedTags.length}
        unreadable audio
      {/if}.
    </p>
  {/if}

  {#if datedYearCount > 1}
    <div class="archive-tools">
      <p class="dw-eyebrow">Notes</p>
      <div>
        <button type="button" class="dw-text-btn dw-text-btn-accent" on:click={focusRecentYears}>Focus</button>
        <button type="button" class="dw-text-btn" on:click={expandAllYears}>All years</button>
      </div>
    </div>
  {/if}

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
                {#each group.items as transcription (transcription.jsonFile)}
                  {@const cleaned = cleanedOf(transcription)}
                  {@const tags = tagsOf(transcription)}
                  {@const isOpen = expanded[transcription.jsonFile]}
                  {@const playing = isOpen && typeof transcription.transcriptionJson?._currentTime === 'number'}
                  <article class="note dw-card dw-card-hover" class:is-open={isOpen} class:is-playing={playing}>
                    <button
                      type="button"
                      class="note-head"
                      title={transcription.jsonFile}
                      on:click={() => toggleExpanded(transcription.jsonFile)}
                    >
                      <span class="note-title">
                        <span class="name">{displayName(transcription.jsonFile)}</span>
                        {#if transcription.transcriptionJson?.elapsed}
                          <span class="elapsed">{transcription.transcriptionJson.elapsed}</span>
                        {/if}
                        {#if transcription.transcriptionJson?.cleanupSkipped}
                          <span class="status">cleanup skipped</span>
                        {:else if !cleaned}
                          <span class="status">{transcription.transcriptionJson?.cleanupError ? 'cleanup failed' : 'raw only'}</span>
                        {/if}
                      </span>
                      {#if !isOpen}
                        <span class="preview">
                          {preview(
                            cleaned ||
                              transcription.transcriptionJson?.preview ||
                              transcription.transcriptionJson?.text ||
                              ''
                          )}
                        </span>
                      {/if}
                    </button>
                    {#if tags.length}
                      <div class="note-tags">
                        {#each tags as tag}
                          <button
                            type="button"
                            class="dw-chip"
                            class:is-active={selectedTags.includes(tag)}
                            on:click={() => toggleTag(tag)}
                          >
                            {tag}
                          </button>
                        {/each}
                      </div>
                    {/if}
                    {#if isOpen}
                      <div class="note-body">
                        <audio
                          controls
                          preload="metadata"
                          src={audioUrl(transcription.jsonFile)}
                          on:timeupdate={(event) => onAudioTime(transcription, event)}
                        ></audio>
                        {#if cleaned}
                          {@const cleanedBy = cleanupLabel(transcription.transcriptionJson)}
                          {#if cleanedBy}
                            <p class="dw-muted">Cleaned {cleanedBy}</p>
                          {/if}
                          {#if transcription.transcriptionJson?.playbackCuesSource !== 'words'}
                            <p class="dw-muted">
                              Section times need a re-transcribe for word timestamps. Raw segments below still have Whisper times.
                            </p>
                          {/if}
                          {#if !showRaw[transcription.jsonFile]}
                            {#each cuesOf(transcription) as cue, index}
                              <button
                                type="button"
                                class="cue"
                                class:is-active={cueActive(transcription, cue, index)}
                                class:untimed={!cueHasTime(cue)}
                                class:dw-cue-pulse={cueActive(transcription, cue, index)}
                                on:click={(event) => playCue(event, cue)}
                              >
                                <span class="cue-time">{cueHasTime(cue) ? formatTime(cue.start) : '—'}</span>
                                <span class="cue-text">{cue.text}</span>
                              </button>
                            {/each}
                          {/if}
                        {:else}
                          <p class="dw-muted">No cleaned text yet. Raw transcript below.</p>
                        {/if}
                        {#if (transcription.transcriptionJson?.segments || []).length}
                          <div class="dw-segmented" role="group" aria-label="Transcript view">
                            <button
                              type="button"
                              class:is-on={!showRaw[transcription.jsonFile]}
                              on:click={() => {
                                showRaw[transcription.jsonFile] = false;
                                showRaw = showRaw;
                              }}
                            >
                              Readable
                            </button>
                            <button
                              type="button"
                              class:is-on={!!showRaw[transcription.jsonFile]}
                              on:click={() => {
                                showRaw[transcription.jsonFile] = true;
                                showRaw = showRaw;
                              }}
                            >
                              Raw
                            </button>
                          </div>
                        {/if}
                        {#if showRaw[transcription.jsonFile]}
                          <div class="segments">
                            {#each transcription.transcriptionJson.segments as segment}
                              <p>
                                <span class="times">{segment.start}–{segment.end}</span>
                                {segment.text}
                              </p>
                            {/each}
                          </div>
                        {/if}
                        <div class="actions">
                          <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => copyTranscription(transcription)}>
                            Copy
                          </button>
                          {#if !cleaned || transcription.transcriptionJson?.cleanupError}
                            <button
                              type="button"
                              class="dw-btn-secondary dw-btn-compact"
                              disabled={noteBusy[transcription.jsonFile]}
                              on:click={() => retryCleanup(transcription.jsonFile)}
                            >
                              Retry
                            </button>
                          {/if}
                          {#if !cleaned && !transcription.transcriptionJson?.cleanupSkipped}
                            <button
                              type="button"
                              class="dw-btn-secondary dw-btn-compact"
                              disabled={noteBusy[transcription.jsonFile]}
                              on:click={() => skipNoteCleanup(transcription.jsonFile)}
                            >
                              Skip
                            </button>
                          {/if}
                          {#if isHolding(transcription.jsonFile) || (folderOf(transcription.jsonFile).key === 'unfiled' && hasDateName(transcription.jsonFile))}
                            {#if hasDateName(transcription.jsonFile)}
                              <button
                                type="button"
                                class="dw-btn-secondary dw-btn-compact"
                                disabled={noteBusy[transcription.jsonFile]}
                                on:click={() => resolveHolding(transcription.jsonFile, 'overwrite')}
                              >
                                File
                              </button>
                              <button
                                type="button"
                                class="dw-btn-secondary dw-btn-compact"
                                disabled={noteBusy[transcription.jsonFile]}
                                on:click={() => resolveHolding(transcription.jsonFile, 'rename')}
                              >
                                File as copy
                              </button>
                            {/if}
                            {#if isHolding(transcription.jsonFile)}
                              <button
                                type="button"
                                class="dw-btn-secondary dw-btn-compact"
                                disabled={noteBusy[transcription.jsonFile]}
                                on:click={() => resolveHolding(transcription.jsonFile, 'unfile')}
                              >
                                Unfile
                              </button>
                            {/if}
                          {/if}
                          <button
                            type="button"
                            class="dw-btn-secondary dw-btn-compact is-danger"
                            on:click={() => deleteTranscription(transcription.jsonFile)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    {/if}
                  </article>
                {/each}
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

  .tags-head,
  .tags-filter,
  .archive-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem 0.75rem;
    margin-bottom: 0.55rem;
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

  .year-block {
    overflow: hidden;
    border-radius: 0.75rem;
    border: 1px solid rgb(255 255 255 / 0.06);
    background: rgb(0 0 0 / 0.15);
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

  .note {
    position: relative;
    padding: 0.85rem 1rem;
  }

  .note.is-open {
    padding-bottom: 1rem;
  }

  .note.is-playing::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.7rem;
    bottom: 0.7rem;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: linear-gradient(180deg, #fcd34d, #f59e0b, #ea580c);
  }

  .note-head {
    display: block;
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }

  .note-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.45rem 0.6rem;
  }

  .name {
    font-weight: 500;
    color: rgb(250 250 250);
    overflow-wrap: anywhere;
  }

  .elapsed,
  .status {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: rgb(113 113 122);
  }

  .preview {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    margin-top: 0.35rem;
    font-size: 0.875rem;
    line-height: 1.45;
    color: rgb(161 161 170);
  }

  .note-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.45rem;
  }

  .note-body {
    margin-top: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.55;
  }

  .note-body audio {
    width: 100%;
    margin: 0 0 0.75rem;
    color-scheme: dark;
  }

  .cue {
    display: grid;
    grid-template-columns: 3.2rem 1fr;
    gap: 0.6rem;
    width: 100%;
    margin: 0 0 0.25rem;
    padding: 0.45rem 0.5rem;
    border: 0;
    border-left: 3px solid transparent;
    border-radius: 0 0.5rem 0.5rem 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .cue:hover {
    background: rgb(255 255 255 / 0.04);
  }

  .cue.is-active {
    background: rgb(245 158 11 / 0.1);
    border-left-color: var(--dw-accent);
  }

  .cue.dw-cue-pulse {
    animation: dw-msg-highlight-pulse 2s ease-out 1;
  }

  .cue.untimed {
    cursor: default;
  }

  .cue.untimed:hover {
    background: transparent;
  }

  .cue-time {
    padding-top: 0.15rem;
    color: var(--dw-accent);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .cue-text {
    white-space: pre-wrap;
  }

  .dw-segmented {
    margin: 0.65rem 0 0.5rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.85rem;
  }

  .segments {
    margin-top: 0.5rem;
  }

  .segments p {
    margin: 0 0 0.35rem;
    color: rgb(161 161 170);
    font-size: 0.8125rem;
  }

  .times {
    display: inline-block;
    min-width: 6rem;
    color: rgb(113 113 122);
    font-variant-numeric: tabular-nums;
  }

  .load-more {
    padding: 0.35rem 0.15rem 0.15rem;
  }
</style>
