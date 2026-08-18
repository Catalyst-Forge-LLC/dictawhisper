<script>
  import Fuse from 'fuse.js';

  export let transcriptions = [];
  export let socket;

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
  let openGroups = {};
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
  $: visible = searched.filter((item) => {
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
  $: pagedGroups = selectedTags.length
    ? groups
    : [...specialGroups, ...datedGroups.slice(0, monthPage)];
  $: hiddenMonths = selectedTags.length ? 0 : Math.max(0, datedGroups.length - monthPage);
  $: newestKey = datedGroups[0]?.key;

  function isOpen(key) {
    if (Object.prototype.hasOwnProperty.call(openGroups, key)) return openGroups[key];
    if (selectedTags.length) return true;
    return true;
  }

  function onToggle(key, event) {
    openGroups[key] = event.currentTarget.open;
    openGroups = openGroups;
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
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) bump(remaining);
      },
      { rootMargin: '800px' }
    );
    observer.observe(node);
    return {
      update(left) {
        remaining = left;
        if (left > 0 && node.getBoundingClientRect().top < window.innerHeight + 800) bump(left);
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

  socket.on('notes-index', (data) => {
    applyIndex(data?.notes);
  });

  socket.on('transcription', (data) => {
    upsertNote(data);
  });

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
    });
</script>

<section class="transcriptions">
  <div class="search">
    <input
      type="search"
      bind:value={searchQuery}
      placeholder="Search notes, tags, filenames…"
      aria-label="Search notes"
    />
    {#if searchQuery}
      <button type="button" class="clear" on:click={() => (searchQuery = '')}>Clear</button>
    {/if}
  </div>

  {#if inboxError}
    <p class="empty">{inboxError}</p>
  {/if}

  {#if !transcriptions.length}
    <p class="empty">
      No notes yet. Record or drop a file above. If setup looks wrong, run
      <code>pnpm run doctor</code>.
    </p>
  {/if}

  {#if tagCloud.length}
    <details class="tag-cloud" open>
      <summary>
        <span>Tags</span>
        <span class="folder-count">
          {visibleTags.length} shown
          {#if !showSingletons && singletonTags.length}
            · {singletonTags.length} single-use hidden
          {/if}
          {#if !showAllFrequent && (showSingletons ? tagCloud : frequentTags).length > TAG_CLOUD_CAP}
            · {(showSingletons ? tagCloud : frequentTags).length - TAG_CLOUD_CAP} more
          {/if}
        </span>
      </summary>
      {#if selectedTags.length}
        <div class="tag-cloud-head">
          <span class="muted">
            {visible.length} note{visible.length === 1 ? '' : 's'} with {selectedTags.join(' + ')}
          </span>
          <button type="button" class="clear" on:click={() => (selectedTags = [])}>Clear filter</button>
        </div>
      {/if}
      <div class="tag-cloud-body">
        {#each visibleTags as item}
          <button
            type="button"
            class="tag"
            class:active={selectedTags.includes(item.tag)}
            style="font-size: {item.size}"
            on:click={() => toggleTag(item.tag)}
          >
            {item.tag}
            <span class="tag-count">{item.count}</span>
          </button>
        {/each}
      </div>
      <div class="tag-cloud-more">
        {#if !showAllFrequent && (showSingletons ? tagCloud : frequentTags).length > TAG_CLOUD_CAP}
          <button type="button" class="clear" on:click={() => (showAllFrequent = true)}>
            Show all {(showSingletons ? tagCloud : frequentTags).length} listed tags
          </button>
        {/if}
        {#if singletonTags.length}
          <button type="button" class="clear" on:click={() => (showSingletons = !showSingletons)}>
            {showSingletons ? 'Hide single-use tags' : `Show ${singletonTags.length} single-use tags`}
          </button>
        {/if}
        <label class="model-toggle">
          <input type="checkbox" bind:checked={useModelForTags} disabled={consolidateBusy || applyBusy} />
          Ask model for synonyms
        </label>
        <button
          type="button"
          class="clear"
          disabled={consolidateBusy || applyBusy}
          on:click={previewConsolidate}
        >
          {consolidateBusy ? consolidatePhase || 'Reviewing tags…' : 'Consolidate similar tags'}
        </button>
      </div>
      {#if consolidateError}
        <p class="empty">{consolidateError}</p>
      {/if}
      {#if applyResult}
        <p class="muted">
          Merged tags on {applyResult.filesChanged} notes
          ({applyResult.uniqueBefore} → {applyResult.uniqueAfter} unique).
        </p>
      {/if}
      {#if consolidatePlan}
        <div class="consolidate">
          <div class="consolidate-head">
            <strong>
              {consolidatePlan.groups.length
                ? `${consolidatePlan.groups.length} merge${consolidatePlan.groups.length === 1 ? '' : 's'} from ${consolidatePlan.unique} tags`
                : `No close duplicates in ${consolidatePlan.unique} tags`}
            </strong>
            {#if consolidatePhase}
              <span class="muted">{consolidatePhase}</span>
            {:else if consolidatePlan.modelError}
              <span class="muted">Model skipped: {consolidatePlan.modelError}</span>
            {:else if consolidatePlan.modelUsed}
              <span class="muted">Includes model suggestions</span>
            {:else}
              <span class="muted">Spelling pass only</span>
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
                      <span class="tag-count">{group.counts?.[group.keep] || ''}</span>
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
              <button type="button" class="clear" disabled={applyBusy} on:click={applyConsolidate}>
                {applyBusy
                  ? 'Applying…'
                  : `Apply ${selectedConsolidateGroups().length} merge${selectedConsolidateGroups().length === 1 ? '' : 's'}`}
              </button>
              <button type="button" class="clear" disabled={applyBusy} on:click={dismissConsolidate}>
                Cancel
              </button>
            </div>
          {:else}
            <div class="tag-cloud-more">
              <button type="button" class="clear" on:click={dismissConsolidate}>Dismiss</button>
            </div>
          {/if}
        </div>
      {/if}
    </details>
  {/if}

  {#if transcriptions.length && !visible.length}
    <p class="empty">
      No notes match
      {#if searchQuery.trim()}
        “{searchQuery.trim()}”
      {/if}
      {#if searchQuery.trim() && selectedTags.length}
        and
      {/if}
      {#if selectedTags.length}
        {selectedTags.join(' + ')}
      {/if}.
    </p>
  {/if}

  {#each pagedGroups as group}
    <details class="folder" open={isOpen(group.key)} on:toggle={(event) => onToggle(group.key, event)}>
      <summary>
        <span class="folder-name">{groupLabel(group)}</span>
        <span class="folder-count">{group.items.length}</span>
      </summary>
      {#if isOpen(group.key)}
      {#each group.items as transcription}
        {@const cleaned = cleanedOf(transcription)}
        {@const tags = tagsOf(transcription)}
        <article class="note" class:expanded={expanded[transcription.jsonFile]}>
          <header
            title={transcription.jsonFile}
            tabindex="0"
            on:click={() => toggleExpanded(transcription.jsonFile)}
            on:keydown={(event) => event.key === 'Enter' && toggleExpanded(transcription.jsonFile)}
          >
            <div class="note-title">
              <span class="name">{displayName(transcription.jsonFile)}</span>
              {#if transcription.transcriptionJson?.elapsed}
                <span class="elapsed">{transcription.transcriptionJson.elapsed}</span>
              {/if}
              {#if transcription.transcriptionJson?.cleanupSkipped}
                <span class="status">cleanup skipped</span>
              {:else if !cleaned}
                <span class="status">{transcription.transcriptionJson?.cleanupError ? 'cleanup failed' : 'raw only'}</span>
              {/if}
            </div>
            {#if expanded[transcription.jsonFile] && tags.length}
              <div class="note-tags">
                {#each tags as tag}
                  <button
                    type="button"
                    class="tag small"
                    class:active={selectedTags.includes(tag)}
                    on:click|stopPropagation={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                {/each}
              </div>
            {/if}
            {#if !expanded[transcription.jsonFile]}
              <p class="preview">
                {preview(
                  cleaned ||
                    transcription.transcriptionJson?.preview ||
                    transcription.transcriptionJson?.text ||
                    ''
                )}
              </p>
            {/if}
          </header>
          <div class="actions">
            <button type="button" on:click={() => deleteTranscription(transcription.jsonFile)}>DEL</button>
            <button type="button" on:click={() => copyTranscription(transcription)}>COPY</button>
            {#if !cleaned || transcription.transcriptionJson?.cleanupError}
              <button
                type="button"
                disabled={noteBusy[transcription.jsonFile]}
                on:click={() => retryCleanup(transcription.jsonFile)}
              >
                Retry
              </button>
            {/if}
            {#if !cleaned && !transcription.transcriptionJson?.cleanupSkipped}
              <button
                type="button"
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
                  disabled={noteBusy[transcription.jsonFile]}
                  on:click={() => resolveHolding(transcription.jsonFile, 'overwrite')}
                >
                  File
                </button>
                <button
                  type="button"
                  disabled={noteBusy[transcription.jsonFile]}
                  on:click={() => resolveHolding(transcription.jsonFile, 'rename')}
                >
                  File as copy
                </button>
              {/if}
              {#if isHolding(transcription.jsonFile)}
                <button
                  type="button"
                  disabled={noteBusy[transcription.jsonFile]}
                  on:click={() => resolveHolding(transcription.jsonFile, 'unfile')}
                >
                  Unfile
                </button>
              {/if}
            {/if}
          </div>
          {#if expanded[transcription.jsonFile]}
            <div class="note-body">
              <audio
                controls
                preload="metadata"
                src={audioUrl(transcription.jsonFile)}
                on:timeupdate={(event) => onAudioTime(transcription, event)}
              ></audio>
              {#if cleaned}
                {#if transcription.transcriptionJson?.playbackCuesSource !== 'words'}
                  <p class="muted">
                    Section times need a re-transcribe for word timestamps. Raw segments below still have Whisper times.
                  </p>
                {/if}
                {#each cuesOf(transcription) as cue, index}
                  <button
                    type="button"
                    class="cue"
                    class:active={cueActive(transcription, cue, index)}
                    class:untimed={!cueHasTime(cue)}
                    on:click={(event) => playCue(event, cue)}
                  >
                    <span class="cue-time">{cueHasTime(cue) ? formatTime(cue.start) : '—'}</span>
                    <span class="cue-text">{cue.text}</span>
                  </button>
                {/each}
              {:else}
                <p class="muted">No cleaned text yet. Raw transcript below.</p>
              {/if}
              {#if (transcription.transcriptionJson?.segments || []).length}
                <button
                  type="button"
                  class="raw-toggle"
                  on:click={() => {
                    showRaw[transcription.jsonFile] = !showRaw[transcription.jsonFile];
                    showRaw = showRaw;
                  }}
                >
                  {showRaw[transcription.jsonFile] ? 'Hide raw segments' : 'Show raw segments'}
                </button>
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
            </div>
          {/if}
        </article>
      {/each}
      {/if}
    </details>
  {/each}
  {#if hiddenMonths > 0}
    <p class="muted" use:lazyMore={hiddenMonths}>
      {hiddenMonths} older month{hiddenMonths === 1 ? '' : 's'} — scroll to load
    </p>
  {/if}
</section>

<style lang="scss">
  .transcriptions {
    padding: 0.5rem 0 1.5rem;
  }

  .search {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin: 0.25rem 0 0.75rem;
  }

  .search input {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.55rem;
    border: 1px solid #ccc;
    font: inherit;
  }

  .tag-cloud {
    margin: 0.75rem 0 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #ddd;
  }

  .tag-cloud-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 0.4rem;
    font-weight: 600;
  }

  .tag-cloud-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
  }

  .tag-cloud-more {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }

  .tag {
    border: 1px solid #c5d8e6;
    background: #f4f8fb;
    color: #135;
    padding: 0.15rem 0.45rem;
    line-height: 1.3;
    cursor: pointer;
  }

  .tag.small {
    font-size: 0.7rem;
    padding: 0.1rem 0.35rem;
  }

  .tag.active {
    background: #0088cc;
    border-color: #0088cc;
    color: #fff;
  }

  .tag-count {
    opacity: 0.65;
    margin-left: 0.2rem;
    font-size: 0.75em;
  }

  .clear,
  .raw-toggle {
    font-size: 0.75rem;
    padding: 0.2rem 0.45rem;
    background: #666;
  }

  .model-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: #444;
  }

  .consolidate {
    margin-top: 0.7rem;
    padding: 0.55rem 0.6rem 0.65rem;
    background: #f7f4ee;
    border: 1px solid #e2d8c4;
  }

  .consolidate-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    align-items: baseline;
    margin-bottom: 0.4rem;
  }

  .consolidate-list {
    margin: 0 0 0.55rem;
    padding: 0;
    list-style: none;
    max-height: 16rem;
    overflow: auto;
  }

  .consolidate-list li {
    margin: 0.2rem 0;
  }

  .consolidate-list label {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
    font-size: 0.8rem;
    line-height: 1.35;
  }

  .consolidate-list em {
    color: #666;
    font-style: normal;
    margin-left: 0.35rem;
  }

  .empty,
  .muted {
    color: #666;
    padding: 0.5rem 0;
  }

  .folder {
    margin: 0.5rem 0;
    border-top: 1px solid #ddd;
  }

  summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.6rem 0.15rem;
    cursor: pointer;
    list-style: none;
    font-size: 1rem;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .folder-name {
    font-weight: 600;
  }

  .folder-count {
    color: #666;
    font-size: 0.8rem;
  }

  .note {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.35rem 0.5rem;
    padding: 0.55rem 0.15rem 0.7rem;
    border-top: 1px solid #eee;
  }

  .note.expanded {
    background: #faf6f6;
  }

  .note header {
    cursor: pointer;
    min-width: 0;
  }

  .note-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
  }

  .name {
    font-weight: 600;
  }

  .elapsed,
  .status {
    color: #666;
    font-weight: 400;
    font-size: 0.75rem;
  }

  .note-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.3rem;
  }

  .preview {
    margin-top: 0.3rem;
    color: #333;
    line-height: 1.4;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.2rem;
    max-width: 14rem;
  }

  .actions button {
    font-size: 0.75rem;
    padding: 0.25rem 0.45rem;
  }

  .note-body {
    grid-column: 1 / -1;
    padding: 0.25rem 0 0.15rem;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .note-body p {
    margin: 0 0 0.7rem;
  }

  .note-body audio {
    width: 100%;
    margin: 0 0 0.75rem;
  }

  .cue {
    display: grid;
    grid-template-columns: 3.2rem 1fr;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    background: transparent;
    color: inherit;
    padding: 0.45rem 0.35rem;
    margin: 0 0 0.35rem;
    border: 0;
    border-left: 3px solid transparent;
  }

  .cue:hover,
  .cue:focus {
    background: #eef6fb;
    box-shadow: none;
  }

  .cue.active {
    background: #e8f4fa;
    border-left-color: #0088cc;
  }

  .cue.untimed {
    cursor: default;
  }

  .cue.untimed:hover,
  .cue.untimed:focus {
    background: transparent;
  }

  .cue-time {
    color: #0088cc;
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    padding-top: 0.15rem;
  }

  .cue-text {
    font-weight: 400;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .segments p {
    margin: 0 0 0.35rem;
    color: #444;
    font-size: 0.8rem;
  }

  .times {
    display: inline-block;
    min-width: 6rem;
    color: #666;
    font-variant-numeric: tabular-nums;
  }
</style>
