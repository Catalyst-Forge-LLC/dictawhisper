<script>
  import AppIcon from './AppIcon.svelte';
  import TranscriptionQuality from './TranscriptionQuality.svelte';
  import { afterUpdate, createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { displayName, markPreview } from '../markPreview.js';
  import MayDoReview from './MayDoReview.svelte';
  import AudioImprovementDialog from './AudioImprovementDialog.svelte';
  import { audioReviews } from '../audioReviewState.js';
  export let connected = false, saveMayDoStatus, extractMayDos;
  import { stageCopy } from '../activityState.js';

  import { entryPresentation, transcriptPassages, transcriptCopyText, activeMayDoCount, mayDoCounts, markEntryMatch, copyTranscriptText, selectedPassageText } from '../entryPresentation.js';
  export let saveDisplayTitle;
  export let transcription;
  export let variant = 'note';
  export let activityItem = null;
  export let query = '';
  export let selectedTags = [];
  export let expanded = false;
  export let selected = false;
  export let showRaw = false;
  export let busy = false;
  export let playing = false;
  export let disambiguate = false;
  export let landCue = null;

  const dispatch = createEventDispatcher();
  let tagDraft = '';
  export let detailTab = 'transcript';
  export let savedTime = 0;
  let audioElement;
  let audioRestored = false;
  let card;
  let landedFor = '';
  let copiedSegment = '';
  let copyError = '';
  let copyTimer;
  let playTime;
  let audioDuration;
  let playError = '';
  let pendingSeek = null;
  let playWaitTimer;
  let speed = '1';
  let followAudio = false;
  let lastFollow = -1;
  let findOpen = false;
  let findQuery = '';
  let findInput;
  let matchCursor = -1;
  let searchCursor = -1;
  let titleEditing = false;
  let titleInput;
  let titleDraft = '';
  let titleError = '';
  let titleSaving = false;
  let moreOpen = false;
  let improveAudioOpen = false;
  let reviewAttemptId = '', reviewTrigger;
  $: review = $audioReviews[transcription.jsonFile];
  $: pendingVersions = review?.pending || [];
  onMount(() => audioReviews.watch(transcription.jsonFile));
  function openAudioReview(event, id = '') {
    reviewTrigger = event.currentTarget;
    reviewAttemptId = id; audioElement?.pause(); improveAudioOpen = true;
  }
  let lastAudioVersion = null;
  $: audioVersion = transcription.transcriptionJson?.audioEnhancement?.versionId || 'source';
  $: if (lastAudioVersion !== audioVersion) {
    if (lastAudioVersion !== null) { audioElement?.pause(); audioRestored = false; savedTime = 0; playTime = 0; }
    lastAudioVersion = audioVersion;
  }
  let moreButton;
  let morePanel;
  function closeActions() {
    moreOpen = false;
    moreButton?.focus({ preventScroll: true });
  }
  function fitMore() {
    if (!moreOpen || !morePanel) return;
    const readerBottom = card?.closest('.detail-scroll')?.getBoundingClientRect().bottom ?? window.innerHeight;
    const available = Math.min(window.innerHeight, readerBottom) - morePanel.getBoundingClientRect().top - 8;
    morePanel.style.maxHeight = `${Math.max(0, Math.min(620, available))}px`;
  }
  let findButton;
  let selectedPassages = [];
  let selectingPassages = false;
  let selectionSource = '';
  let selectionFallback = '';
  let copyingSelection = false;
  let copiedSelectionCount = 0;
  $: passageSource = JSON.stringify([transcription.jsonFile, original, passages.map(row => [row.text, row.start, row.end])]);
  $: if (selectionSource !== passageSource) {
    if (selectionFallback) copyError = '';
    selectionSource = passageSource; selectedPassages = []; selectingPassages = false; selectionFallback = '';
    if (copiedSegment === 'selected') copiedSegment = '';
  }
  $: selectedText = selectedPassageText(passages, selectedPassages);
  function selectPassage(index, checked) {
    selectingPassages = true;
    selectedPassages = checked ? [...new Set([...selectedPassages, index])] : selectedPassages.filter(value => value !== index);
    selectionFallback = ''; copyError = ''; copiedSegment = '';
  }
  async function beginPassageSelection() {
    selectingPassages = true; moreOpen = false; await tick();
    card?.querySelector('.passage-select input')?.focus({preventScroll:true});
  }
  async function clearPassageSelection() {
    selectedPassages = []; selectingPassages = false; selectionFallback = ''; copyError = ''; copiedSegment = '';
    await tick(); moreButton?.focus({preventScroll:true});
  }
  async function copySelectedPassages() {
    if (!selectedText || copyingSelection) return;
    const text = selectedText, count = selectedPassages.length, source = selectionSource;
    copyingSelection = true;
    try {
      const result = await copyTranscriptText(text, navigator.clipboard);
      if (selectionSource !== source) return;
      selectionFallback = result.error ? text : '';
      copyError = result.error ? 'Could not copy. Select the combined text below and copy it manually.' : '';
      copiedSelectionCount = count; copiedSegment = result.error ? '' : 'selected';
      clearTimeout(copyTimer); if (!result.error) copyTimer = setTimeout(() => copiedSegment = '', 1500);
    } finally { copyingSelection = false; }
  }
  $: presentation = entryPresentation(transcription);
  $: original = !cleaned || showRaw;
  $: passages = transcriptPassages(transcription.transcriptionJson, original);
  $: if (matchCursor >= findMatches.length) matchCursor = -1;
  $: fullText = transcriptCopyText(transcription.transcriptionJson, original);
  $: findMatches = findQuery.trim() ? passages.flatMap((row, index) => {
    const text = String(row.text).toLowerCase(), term = findQuery.trim().toLowerCase();
    const matches = []; let at = text.indexOf(term);
    while (at >= 0) { matches.push({ index, at }); at = text.indexOf(term, at + term.length); }
    return matches;
  }) : [];
  $: searchMatches = query.trim() && !/^filename:/i.test(query) ? passages.map((row, index) => query.trim().split(/\s+/).filter(token => token.length > 1).some(token => String(row.text).toLowerCase().includes(token.toLowerCase())) ? index : -1).filter(index => index >= 0) : [];
  $: if (!titleEditing) titleDraft = transcription.transcriptionJson?.displayTitle || '';
  async function renameTitle() {
    titleError = ''; titleSaving = true;
    try { await saveDisplayTitle(transcription.jsonFile, titleDraft); titleEditing = false; await tick(); moreButton?.focus({ preventScroll: true }); }
    catch (error) { titleError = error.message || 'Could not save title. Your draft is kept.'; }
    finally { titleSaving = false; }
  }
  async function copyFull() {
    selectionFallback = "";
    const result = await copyTranscriptText(fullText, navigator.clipboard); copyError = result.error;
    if (!copyError) { copiedSegment = 'full'; clearTimeout(copyTimer); copyTimer = setTimeout(() => copiedSegment = '', 1500); }
  }
  async function openFind() { findOpen = true; await tick(); findInput?.focus(); }
  async function beginTitleEdit() { titleEditing = true; moreOpen = false; await tick(); titleInput?.focus(); titleInput?.select(); }
  function scrollPassage(index) {
    followAudio = false;
    const node = card?.querySelector(`#cue-${index}`), reader = card?.closest('.detail-scroll');
    if (node && reader) reader.scrollTop += node.getBoundingClientRect().top - reader.getBoundingClientRect().top - (card.querySelector('.reader-controls')?.getBoundingClientRect().height || 0) - 8;
  }
  function stepMatch(direction) {
    if (!findMatches.length) return;
    matchCursor = (matchCursor + direction + findMatches.length) % findMatches.length;
    scrollPassage(findMatches[matchCursor].index);
  }
  function stepSearch(direction) {
    if (!searchMatches.length) return;
    searchCursor = (searchCursor + direction + searchMatches.length) % searchMatches.length;
    scrollPassage(searchMatches[searchCursor]);
  }
  function setSpeed(value) {
    speed = value; if (audioElement) audioElement.playbackRate = Number(speed);
    try { localStorage.setItem('dw.playback-speed.v1', speed); } catch { /* Browser storage is optional. */ }
  }
  function playbackFailed() { clearTimeout(playWaitTimer); pendingSeek = null; const code = audioElement?.error?.code; playError = code === 4 ? 'Audio is missing or unsupported. Reading and copying are still available.' : code === 3 ? 'This audio could not be decoded. Reading and copying are still available.' : code === 2 ? 'Audio could not load because of a network error. Reading and copying are still available.' : 'Audio could not play. Reading and copying are still available.'; }
  async function playAudio() {
    try { playError = ''; await audioElement.play(); }
    catch { if (audioElement?.error) playbackFailed(); else playError = 'Playback was blocked. Try Play audio or use the player controls.'; }
  }
  function updateAudio(event) {
    playTime = event.currentTarget.currentTime;
    if (audioRestored) dispatch('time', { item: transcription, event });
    if (!followAudio || event.currentTarget.paused) return;
    const index = passages.findIndex((cue, i) => cueActive(transcription, cue, i, playTime));
    if (index < 0 || index === lastFollow) return;
    lastFollow = index;
    const node = card?.querySelector(`#cue-${index}`), reader = card?.closest('.detail-scroll');
    if (node && reader) reader.scrollTop += node.getBoundingClientRect().top - reader.getBoundingClientRect().top - card.querySelector('.reader-controls').getBoundingClientRect().height - 8;
  }
  onMount(() => {
    if (!expanded) return;
    try { const saved = localStorage.getItem('dw.playback-speed.v1'); if (['0.75','1','1.25','1.5','2'].includes(saved)) speed = saved; } catch { /* Optional storage. */ }
    const reader = card.closest('.detail-scroll');
    const manual = () => followAudio = false;
    const pause = () => audioElement?.pause();
    const closeMore = event => { if (moreOpen && !card.querySelector('.more')?.contains(event.target)) moreOpen = false; };
    const escapeMore = event => { if (moreOpen && event.key === 'Escape' && card.contains(document.activeElement)) { moreOpen = false; moreButton?.focus(); } };
    window.addEventListener('pointerdown', closeMore); window.addEventListener('keydown', escapeMore);
    window.addEventListener('resize', fitMore);
    reader?.addEventListener('scroll', fitMore, { passive: true });
    reader?.addEventListener('wheel', manual, { passive: true });
    reader?.addEventListener('touchstart', manual, { passive: true });
    reader?.addEventListener('pointerdown', manual, { passive: true });
    reader?.addEventListener('keydown', manual);
    window.addEventListener('dw-recording-started', pause);
    return () => { window.removeEventListener('resize', fitMore); reader?.removeEventListener('scroll', fitMore); window.removeEventListener('pointerdown', closeMore); window.removeEventListener('keydown', escapeMore); reader?.removeEventListener('wheel', manual); reader?.removeEventListener('touchstart', manual); reader?.removeEventListener('pointerdown', manual); reader?.removeEventListener('keydown', manual); window.removeEventListener('dw-recording-started', pause); };
  });
  onDestroy(() => { clearTimeout(copyTimer); clearTimeout(playWaitTimer); audioElement?.pause(); });
  function chooseTab(tab) { detailTab = tab; dispatch('tab', { file: transcription.jsonFile, tab }); }
  function selectEntry(event, tab) { dispatch('toggle', { file: transcription.jsonFile, keyboard: event.detail === 0, tab }); }
  function restoreAudio(event) {
    const audio = event.currentTarget;
    audio.playbackRate = Number(speed);
    audioDuration = Number.isFinite(audio.duration) ? audio.duration : null;
    if (!audioRestored) {
      audioRestored = true;
      audio.currentTime = Math.min(Math.max(0, savedTime), audioDuration ?? savedTime);
    }
    if (pendingSeek !== null) {
      clearTimeout(playWaitTimer); audio.currentTime = Math.min(pendingSeek, audioDuration ?? pendingSeek); pendingSeek = null; void playAudio();
    }
  }

  async function copySegment(text, key) {
    selectionFallback = "";
    const result = await copyTranscriptText(text, navigator.clipboard);
    copyError = result.error; copiedSegment = copyError ? '' : key;
    clearTimeout(copyTimer);
    if (!copyError) copyTimer = setTimeout(() => copiedSegment = '', 1500);
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
    const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
    if (oneLine.length <= limit) return oneLine;
    return `${oneLine.slice(0, limit)}…`;
  }

  function audioUrl(jsonFile, version = 'source') {
    return `/audio?file=${encodeURIComponent(jsonFile)}&version=${version}`;
  }

  function audioDownloadUrl(jsonFile) {
    return `/audio?file=${encodeURIComponent(jsonFile)}&download=1`;
  }

  function sidecarDownloadUrl(jsonFile) {
    return `/note?file=${encodeURIComponent(jsonFile)}&download=1`;
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
    if (!event?.isTrusted || event.type !== 'click' || !cueHasTime(cue) || !audioElement) return;
    playError = ''; pendingSeek = Math.max(0, cue.start); audioRestored = true;
    if (audioElement.readyState >= 1) { audioElement.currentTime = Math.min(pendingSeek, Number.isFinite(audioElement.duration) ? audioElement.duration : pendingSeek); pendingSeek = null; void playAudio(); }
    else { clearTimeout(playWaitTimer); playWaitTimer = setTimeout(playbackFailed, 10000); audioElement.load(); }
  }

  function cueActive(item, cue, index, current) {
    if (!cueHasTime(cue)) return false;
    if (typeof current !== 'number') return false;
    const next = passages[index + 1];
    const end = cue.end > cue.start ? cue.end : next ? next.start : Infinity;
    return current >= cue.start && current < end;
  }

  function folderOf(jsonFile) {
    const norm = String(jsonFile || '').replace(/\\/g, '/');
    if (/\/_holding(?:\/|$)/i.test(norm)) return 'holding';
    if (/\/_unfiled(?:\/|$)/i.test(norm)) return 'unfiled';
    return '';
  }

  function hasDateName(jsonFile) {
    return /^\d{4}-\d{2}-\d{2}/.test(displayName(jsonFile));
  }

  function isStarred(item) {
    return Boolean(item.transcriptionJson?.starred);
  }

  function addTag() {
    const tag = tagDraft.trim();
    if (!tag) return;
    const next = [...tagsOf(transcription), tag];
    tagDraft = '';
    dispatch('savetags', { jsonFile: transcription.jsonFile, tags: next });
  }

  function removeTag(tag) {
    dispatch('savetags', {
      jsonFile: transcription.jsonFile,
      tags: tagsOf(transcription).filter((item) => item !== tag),
    });
  }

  function landTarget() {
    if (!expanded || landCue == null) return;
    const key = `${transcription.jsonFile}:${landCue}`;
    if (landedFor === key) return;
    const el = card?.querySelector(`#cue-${landCue}`);
    if (!el) return;
    landedFor = key;
    const reader = card.closest('.detail-scroll');
    if (reader) reader.scrollTop += el.getBoundingClientRect().top - reader.getBoundingClientRect().top - (card.querySelector('.reader-controls')?.getBoundingClientRect().height || 0) - 8;
  }

  afterUpdate(landTarget);

  $: cleaned = cleanedOf(transcription);
  $: cleanedBy = cleanupLabel(transcription.transcriptionJson);
  $: tags = tagsOf(transcription);
  $: starred = isStarred(transcription);
  $: holding = folderOf(transcription.jsonFile) === 'holding';
  $: unfiled = folderOf(transcription.jsonFile) === 'unfiled';
  $: tagFieldId = `tag-${String(transcription.jsonFile || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
</script>

<article
  bind:this={card}
  data-entry-key={transcription.jsonFile}
  class={variant === "detail" ? "note reader-body" : "note dw-card"}
  class:is-open={expanded}
  class:is-selected={selected}
  class:is-playing={playing}
  class:is-hit={variant === 'hit'}
>
  {#if variant !== "detail"}
  <div class="note-top">
    <button
      type="button"
      class="note-head"
      title={transcription.jsonFile}
      aria-pressed={selected}
      on:click={selectEntry}
    >
      <span class="note-title">
        <span class="name">{presentation.title}</span>
        {#if presentation.dateLabel}<span class="day">{presentation.dateLabel}{disambiguate && presentation.sequence ? ` · recording ${presentation.sequence}` : ''}</span>{/if}
        {#if pendingVersions.length}<span class="review-badge"><AppIcon name="waveform" size={14}/>New transcript ready{pendingVersions.length > 1 ? ` · ${pendingVersions.length}` : ''}</span>{/if}
        {#if activityItem && !['ready','raw_only'].includes(activityItem.stage)}
          <span class="status">{activityItem.stage.replaceAll('_',' ')}</span>
        {:else if transcription.transcriptionJson?.cleanupSkipped}
          <span class="status">cleanup skipped</span>
        {:else if !cleaned}
          <span class="status">{transcription.transcriptionJson?.cleanupError ? 'cleanup failed' : 'raw only'}</span>
        {/if}
      </span>
      {#if !expanded}
        <span class="preview">
          {#if variant === 'hit' && query.trim()}
            {@html markPreview(
              preview(
                transcription.snippet ||
                  cleaned ||
                  transcription.transcriptionJson?.preview ||
                  transcription.transcriptionJson?.text ||
                  ''
              ),
              query
            )}
          {:else}
            {preview(cleaned || transcription.transcriptionJson?.preview || transcription.transcriptionJson?.text || '')}
          {/if}
        </span>
      {/if}
    </button>
    <button
      type="button"
      class="star"
      class:is-on={starred}
      aria-pressed={starred}
      aria-label={starred ? 'Unstar note' : 'Star note'}
      disabled={busy}
      on:click={() => dispatch('star', { jsonFile: transcription.jsonFile, starred: !starred })}
    >
      <AppIcon name="star" size={16} filled={starred}/>
    </button>
  </div>

  {/if}

  {#if !expanded && mayDoCounts(transcription.transcriptionJson).mayDoTotalCount}
    <button class="dw-chip maydo-badge" on:click={event => selectEntry(event, 'maydos')}>MayDos · {activeMayDoCount(transcription.transcriptionJson)} active / {mayDoCounts(transcription.transcriptionJson).mayDoTotalCount} saved</button>
  {/if}

  {#if tags.length && !expanded}
    <div class="note-tags">
      {#each (expanded ? tags : [...tags.filter(tag => selectedTags.includes(tag)), ...tags.filter(tag => !selectedTags.includes(tag))].slice(0, 2)) as tag}
        {#if expanded}
          <span class="dw-chip" class:is-active={selectedTags.includes(tag)}>
            <button type="button" class="chip-label" on:click={() => dispatch('tag', tag)}>{tag}</button>
            <button type="button" class="chip-x" aria-label={`Remove ${tag}`} disabled={busy} on:click={() => removeTag(tag)}>
              ×
            </button>
          </span>
        {:else}
          <button
            type="button"
            class="dw-chip"
            class:is-active={selectedTags.includes(tag)}
            on:click={() => dispatch('tag', tag)}
          >
            {tag}
          </button>
        {/if}
      {/each}
      {#if !expanded && tags.length > 2}<button class="dw-text-btn" on:click={event => selectEntry(event, 'tags')}>+{tags.length - 2} more</button>{/if}
    </div>
  {/if}

  {#if expanded}
    {#if variant==='detail' && activityItem && !['ready','raw_only'].includes(activityItem.stage)}<p class="dw-muted" role="status">{stageCopy[activityItem.stage]}{#if activityItem.error} · {activityItem.error}{/if}</p>{/if}
    {#if pendingVersions.length}
      <div class="version-notice" role="status">
        <div><strong>{pendingVersions.length === 1 ? 'New transcript ready' : `${pendingVersions.length} new transcripts ready`}</strong><p>You’re reading the saved version. Review before switching.</p></div>
        <button class="dw-btn-secondary dw-with-icon" on:click={event => openAudioReview(event, pendingVersions[0].id)}><AppIcon name="waveform" size={16}/>Review new transcript</button>
      </div>
    {/if}
    {#if variant === 'detail' && review?.error}<p class="version-error" role="status">Version status unavailable{pendingVersions.length ? ' · showing last known status' : ''}. <button class="dw-text-btn" on:click={() => audioReviews.refresh()}>Retry version check</button></p>{/if}
    <div class="note-body">
      <div class="reader-controls">
      <div class="reader-command-row">
      <div class="detail-tabs" role="group" aria-label="Entry sections">
        <button class="dw-with-icon" class:is-on={detailTab === 'transcript'} aria-pressed={detailTab === 'transcript'} on:click={() => chooseTab('transcript')}><AppIcon name="transcript" size={16}/>Transcript</button>
        <button class="dw-with-icon" class:is-on={detailTab === 'maydos'} aria-pressed={detailTab === 'maydos'} on:click={() => chooseTab('maydos')} title="Count of Suggested and Selected actions; all saved actions are available here"><AppIcon name="maydos" size={16}/>MayDos <span>{activeMayDoCount(transcription.transcriptionJson)} / {mayDoCounts(transcription.transcriptionJson).mayDoTotalCount}</span>{#if transcription.transcriptionJson?.mayDoError} !{/if}</button>
        <button class="dw-with-icon" class:is-on={detailTab === 'tags'} aria-pressed={detailTab === 'tags'} on:click={() => chooseTab('tags')}><AppIcon name="tags" size={16}/>Tags <span>{tags.length}</span></button>
      </div>

      <div class="reader-commands">
        {#if detailTab === 'transcript'}<div class="dw-segmented" role="group" aria-label="Transcript view"><button disabled={!cleaned} aria-pressed={!original} class:is-on={!original} on:click={() => dispatch('raw', { jsonFile: transcription.jsonFile, show: false })}>Readable</button><button aria-pressed={original} class:is-on={original} on:click={() => dispatch('raw', { jsonFile: transcription.jsonFile, show: true })}>Original</button></div>{/if}
        <button class="dw-text-btn dw-with-icon" aria-label="Copy full transcript" disabled={!fullText} on:click={copyFull}><AppIcon name="copy" size={16}/>Copy transcript</button>
        <button bind:this={findButton} class="dw-text-btn dw-with-icon" on:click={openFind}><AppIcon name="search" size={16}/>Find in entry</button>
        <details bind:open={moreOpen} on:toggle={fitMore} class="more"><summary class="dw-with-icon" bind:this={moreButton}><AppIcon name="more"/>More</summary><div class="more-menu" bind:this={morePanel} aria-label="Entry actions">
          <div class="menu-group">
            {#if detailTab === 'transcript'}<button class="menu-action" disabled={!passages.length} on:click={beginPassageSelection}><AppIcon name="select"/><span>Select passages</span></button>{/if}
            <button class="menu-action" on:click={beginTitleEdit}><AppIcon name="rename"/><span>Rename display title</span></button>
            <a class="menu-action" href={audioDownloadUrl(transcription.jsonFile)}><AppIcon name="download"/><span>Download audio</span></a>
            <a class="menu-action" href={sidecarDownloadUrl(transcription.jsonFile)}><AppIcon name="json"/><span>Export entry JSON</span></a>
          </div>
          <div class="mobile-playback menu-group"><label class="speed">Speed<select value={speed} on:change={event => setSpeed(event.target.value)} aria-label="Playback speed">{#each ['0.75','1','1.25','1.5','2'] as value}<option value={value}>{value}×</option>{/each}</select></label><label class="follow"><input type="checkbox" bind:checked={followAudio} />Follow audio</label></div>
          {#if searchMatches.length}<div class="menu-group"><p>{searchMatches.length} matching passages</p><button class="menu-action" on:click={() => { stepSearch(-1); moreOpen = false; }}><AppIcon name="left"/><span>Previous search match</span></button><button class="menu-action" on:click={() => { stepSearch(1); moreOpen = false; }}><AppIcon name="chevron"/><span>Next search match</span></button></div>{/if}
          <div class="menu-group">
            <button class="menu-action" disabled={busy} on:click={event => { closeActions(); openAudioReview(event, pendingVersions[0]?.id || ''); reviewTrigger = moreButton; }}><AppIcon name="waveform"/><span>{pendingVersions.length ? 'Review new transcript…' : 'Improve audio & retranscribe…'}</span></button>
            <button class="menu-action" disabled={busy} on:click={() => { closeActions(); dispatch('retry', transcription.jsonFile); }}><AppIcon name="refresh"/><span>Reprocess readable transcript</span></button>
            <button class="menu-action" disabled={busy} on:click={() => { closeActions(); dispatch('skip', transcription.jsonFile); }}><AppIcon name="skip"/><span>Skip cleanup</span></button>
            <details class="processing-details"><summary class="menu-action"><AppIcon name="info"/><span>Processing details</span><span class="disclosure-chevron"><AppIcon name="chevron" size={14}/></span></summary><div class="processing-content"><p>{presentation.path}</p><p>{presentation.dateLabel}{presentation.precision === 'month' ? ' · Month precision; no recording day is known.' : ''}</p>{#if presentation.sequence}<p>Recording {presentation.sequence}</p>{/if}{#if audioDuration != null}<p>Audio duration {formatTime(audioDuration)}</p>{/if}{#if transcription.transcriptionJson?.elapsed}<p>Processing time {transcription.transcriptionJson.elapsed}</p>{/if}{#if cleanedBy}<p>Cleaned {cleanedBy}</p>{/if}</div></details>
          </div>
          <div class="menu-group">
            {#if holding || (unfiled && hasDateName(transcription.jsonFile))}<button class="menu-action" disabled={busy} on:click={() => { closeActions(); dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'rename' }); }}><AppIcon name="folder"/><span>Organize / resolve conflict…</span></button>{/if}
            {#if holding}<button class="menu-action" disabled={busy} on:click={() => { closeActions(); dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'unfile' }); }}><AppIcon name="folder"/><span>Move to Unfiled</span></button>{/if}
            <button class="menu-action" disabled={busy} on:click={() => { closeActions(); dispatch('resolve', {jsonFile:transcription.jsonFile}); }}><AppIcon name="date"/><span>Assign recording date…</span></button>
          </div>
          <div class="menu-group"><button class="menu-action is-danger" disabled={busy} on:click={() => { closeActions(); dispatch('delete', transcription.jsonFile); }}><AppIcon name="trash"/><span>Move to Trash</span></button></div>
        </div></details>
      </div></div>
      <div class="player-row"><audio bind:this={audioElement} data-position-restored={audioRestored} controls preload="metadata" on:loadedmetadata={restoreAudio} on:error={playbackFailed} src={audioUrl(transcription.jsonFile, audioVersion)} on:timeupdate={updateAudio} on:play={() => { for (const audio of document.querySelectorAll('audio')) if (audio !== audioElement) audio.pause(); }}></audio>
      <label class="speed">Speed<select value={speed} on:change={event => setSpeed(event.target.value)} aria-label="Playback speed">{#each ['0.75','1','1.25','1.5','2'] as value}<option value={value}>{value}×</option>{/each}</select></label><label class="follow"><input type="checkbox" bind:checked={followAudio} />Follow audio</label></div>
      {#if playError}<p class="dw-error" role="alert">{playError} <button class="dw-text-btn" on:click={playAudio}>Play audio</button></p>{/if}
      {#if copiedSegment || copyError}<p role={copyError ? 'alert' : 'status'} class:dw-error={copyError} class:copy-success={!copyError}>{copyError || (copiedSegment === 'full' ? 'Transcript copied' : copiedSegment === 'selected' ? `${copiedSelectionCount} ${copiedSelectionCount === 1 ? 'passage' : 'passages'} copied` : 'Passage copied')}</p>{/if}
      {#if detailTab === 'transcript' && selectingPassages}<div class="passage-selection-bar" role="group" aria-label="Selected passages">
        <span role="status">{selectedPassages.length} selected</span>
        <button class="dw-btn-secondary dw-btn-compact" disabled={!selectedText || copyingSelection} on:click={copySelectedPassages}>{copyingSelection ? 'Copying…' : 'Copy selected'}</button>
        <button class="dw-text-btn" disabled={selectedPassages.length === passages.length} on:click={() => { selectedPassages = passages.map((_, index) => index); selectionFallback = ''; copyError = ''; }}>Select all</button>
        <button class="dw-text-btn" on:click={clearPassageSelection}>Clear selection</button>
      </div>{/if}
      {#if selectionFallback && detailTab === 'transcript'}<label class="selection-fallback">Selected passage text<textarea readonly rows="4" value={selectionFallback} on:focus={event => event.currentTarget.select()}></textarea></label>{/if}
      {#if titleEditing}<form class="title-editor" on:submit|preventDefault={renameTitle}><label>Display title<input class="dw-input" maxlength="160" bind:this={titleInput} bind:value={titleDraft} placeholder={presentation.title} /></label><button class="dw-btn-secondary dw-btn-compact" disabled={titleSaving}>Save title</button><button type="button" class="dw-text-btn" on:click={() => titleEditing = false}>Cancel</button><p class="dw-muted">Leave blank to use the filename title. Files keep their names.</p>{#if titleError}<p class="dw-error" role="alert">{titleError}</p>{/if}</form>{/if}
      {#if findOpen}<div class="find-bar"><label>Find in entry<input class="dw-input" bind:this={findInput} bind:value={findQuery} on:input={() => matchCursor = -1} on:keydown={event => { if (event.key === 'Enter') stepMatch(event.shiftKey ? -1 : 1); if (event.key === 'Escape') { findOpen = false; findButton?.focus(); } }} /></label><span role="status">{findMatches.length ? (matchCursor < 0 ? `${findMatches.length} matches` : `${matchCursor + 1} of ${findMatches.length} matches`) : '0 matches'}</span><button disabled={!findMatches.length} on:click={() => stepMatch(-1)}>Previous match</button><button disabled={!findMatches.length} on:click={() => stepMatch(1)}>Next match</button><button on:click={() => { findOpen = false; findButton?.focus(); }}>Close find</button></div>{/if}
      </div>

      {#if detailTab === 'transcript'}<TranscriptionQuality quality={transcription.transcriptionJson?.transcriptionQuality} listen={playCue}/>{/if}
      {#if detailTab === 'maydos'}
      <MayDoReview json={transcription.transcriptionJson} file={transcription.jsonFile} {connected} saveStatus={saveMayDoStatus} extract={extractMayDos} playSource={playCue} on:configure={() => dispatch('configurecleanup')} />
      {:else if detailTab === 'tags'}
  {#if tags.length}
    <div class="note-tags">
      {#each (expanded ? tags : [...tags.filter(tag => selectedTags.includes(tag)), ...tags.filter(tag => !selectedTags.includes(tag))].slice(0, 2)) as tag}
        {#if expanded}
          <span class="dw-chip" class:is-active={selectedTags.includes(tag)}>
            <button type="button" class="chip-label" on:click={() => dispatch('tag', tag)}>{tag}</button>
            <button type="button" class="chip-x" aria-label={`Remove ${tag}`} disabled={busy} on:click={() => removeTag(tag)}>
              ×
            </button>
          </span>
        {:else}
          <button
            type="button"
            class="dw-chip"
            class:is-active={selectedTags.includes(tag)}
            on:click={() => dispatch('tag', tag)}
          >
            {tag}
          </button>
        {/if}
      {/each}
    </div>
  {/if}

      <form
        class="tag-edit"
        on:submit|preventDefault={addTag}
      >
        <label class="dw-eyebrow" for={tagFieldId}>Tags</label>
        <div class="tag-row">
          <input
            id={tagFieldId}
            class="dw-input"
            type="text"
            bind:value={tagDraft}
            placeholder="Add a tag"
            disabled={busy}
          />
          <button type="submit" class="dw-btn-secondary dw-btn-compact" disabled={busy || !tagDraft.trim()}>Add</button>
        </div>
      </form>
      {:else}
      {#if original}<p class="original-status dw-muted">Original transcript{#if !cleaned} · {transcription.transcriptionJson?.cleanupError ? 'cleanup failed' : 'readable version unavailable'} <button class="dw-text-btn" disabled={busy} on:click={() => dispatch('retry', transcription.jsonFile)}>Retry cleanup</button>{/if}</p>{/if}
      {#each passages as cue, index}
        <div class="cue-row" class:find-match={findMatches[matchCursor]?.index === index} class:passage-selected={selectedPassages.includes(index)} class:selection-mode={selectingPassages}>
          <label class="passage-select" title={`Select passage ${index + 1}`}><input type="checkbox" aria-label={`Select passage ${index + 1}`} checked={selectedPassages.includes(index)} on:change={event => selectPassage(index, event.currentTarget.checked)} /></label>
          <div id={`cue-${index}`} class="cue" class:is-active={cueActive(transcription, cue, index, playTime)}>
            {#if cueHasTime(cue)}<button class="cue-time" aria-label={`Play passage at ${formatTime(cue.start)}`} on:click={event => playCue(event, cue)}>{formatTime(cue.start)}</button>{:else}<span class="cue-time" aria-label="No timing available">—</span>{/if}
            <div class="cue-text">{@html markEntryMatch(cue.text, findOpen ? findQuery : '')}</div>
          </div>
          <button class="segment-copy" aria-label="Copy passage" title="Copy passage" on:click={() => copySegment(cue.text, 'cue-' + index)}><AppIcon name={copiedSegment === 'cue-' + index ? 'check' : 'copy'} size={16}/></button>
        </div>
      {:else}<p class="dw-muted">No transcript text is available.</p>{/each}

      {/if}

    </div>
  {/if}
</article>
{#if expanded && improveAudioOpen}<AudioImprovementDialog file={transcription.jsonFile} initialAttemptId={reviewAttemptId} on:changed={() => { void audioReviews.refresh(); dispatch('versionchanged'); }} on:close={() => { improveAudioOpen = false; void audioReviews.refresh(); tick().then(() => (reviewTrigger?.isConnected ? reviewTrigger : moreButton)?.focus({ preventScroll: true })); }} />{/if}

<style lang="scss">
  .review-badge { display: inline-flex; align-items: center; gap: 5px; color: var(--dw-accent-bright); font-size: 12px; }
  .version-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--dw-border); border-left: 3px solid var(--dw-accent); border-radius: 6px; background: rgb(245 158 11 / .06); font-size: 13px; }
  .version-notice p { color: var(--dw-text-muted); margin: 3px 0 0; }
  .version-notice button, .version-error button { min-height: 44px; }
  .version-error { color: var(--dw-text-muted); font-size: 13px; }
  .detail-tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.45rem; }
  .detail-tabs button { flex-shrink: 0; white-space: nowrap; border: 1px solid transparent; border-radius: 0.4rem; background: transparent; color: var(--dw-text-muted); font: inherit; font-size: 0.8125rem; padding: 0.3rem 0.55rem; cursor: pointer; }
  .detail-tabs button.is-on { border-color: var(--dw-border); background: rgb(245 158 11 / 0.08); color: var(--dw-accent-bright); }
  .detail-tabs span { white-space: nowrap; font-size: 0.7rem; }
  .note.is-selected { border-color: var(--dw-accent); background: rgb(245 158 11 / 0.08); }
  .maydo-badge { margin-top: 0.45rem; color: var(--dw-accent-bright); }
  .cue-row { position: relative; padding-right: 76px; min-height: 44px; }
  .passage-select { position: absolute; right: 36px; top: 0.35rem; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; opacity: 0; cursor: pointer; border-radius: 6px; }
  .passage-select input { width: 18px; height: 18px; margin: 0; accent-color: var(--dw-accent); cursor: pointer; }
  .cue-row:hover .passage-select, .cue-row:focus-within .passage-select, .selection-mode .passage-select { opacity: 1; }
  .passage-select:focus-within { outline: 2px solid var(--dw-accent-bright); outline-offset: 1px; }
  .passage-selected { background: rgb(245 158 11 / 0.08); border-radius: 6px; }
  .passage-selection-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 0; font-size: 12px; }
  .passage-selection-bar button { min-height: 36px; }
  .selection-fallback { display: block; font-size: 12px; }
  .selection-fallback textarea { display: block; width: 100%; color: var(--dw-text); background: #27272a; border: 1px solid var(--dw-border); padding: 8px; }
  @media (hover: none), (pointer: coarse), (max-width: 959px) { .cue-row { padding-right: 96px; } .passage-select { opacity: 1; right: 46px; width: 44px; height: 44px; } .passage-selection-bar button { min-height: 44px; } }
  .segment-copy { position: absolute; top: 0.45rem; right: 0; opacity: 0; background: rgb(39 39 42); color: var(--dw-text); border: 1px solid var(--dw-border); border-radius: 0.35rem; padding: 0.2rem 0.45rem; cursor: pointer; font-size: 1rem; }
  .cue-row:hover .segment-copy, .cue-row:focus-within .segment-copy { opacity: 1; }
  @media (hover: none) { .segment-copy { opacity: 1; } }
  .note {
    position: relative;
    padding: 10px 12px;
    box-shadow: none; backdrop-filter: none; border-radius: 8px;
  }

  .note.is-open {
    padding-bottom: 1rem;
  }

  .note.is-hit,
  .note.is-playing {
    padding-left: 1.05rem;
  }

  .note.is-hit::before,
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

  .note-top {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
  }

  .note-head {
    display: block;
    flex: 1;
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

  .day,
  .status {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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

  .star {
    flex-shrink: 0;
    border: 0;
    background: transparent;
    color: rgb(113 113 122);
    cursor: pointer;
    font-size: 1.05rem;
    line-height: 1;
    padding: 0.15rem 0.25rem;
    border-radius: 0.375rem;
  }

  .star:hover {
    background: rgb(245 158 11 / 0.12);
    color: rgb(253 230 138);
  }

  .star.is-on {
    color: var(--dw-accent-bright);
  }

  .note-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.45rem;
  }

  .chip-label,
  .chip-x {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }

  .chip-x {
    margin-left: 0.15rem;
    opacity: 0.7;
  }

  .note-body {
    margin-top: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.55;
  }

  .note-body audio {
    width: 100%;
    height: 2.5rem;
    margin: 0 0 0.35rem;
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

  .tag-edit {
    margin-top: 0.85rem;
  }

  .tag-row {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.35rem;
  }





  .reader-body.note.is-open { border: 0; background: transparent; padding: 0; box-shadow: none; }
  .reader-body .note-body { margin-top: 0; }
  .reader-body .detail-tabs { margin-bottom: 2px; }
  .reader-body .note-body audio { margin-bottom: 0; }
  .reader-body .cue-row { max-width: 72ch; margin-inline: auto; }
  .note-title .name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .note.is-selected { border-color: rgb(245 158 11 / 0.6); background: rgb(245 158 11 / 0.04); }
  @media (max-width: 959px), (pointer: coarse) { .detail-tabs button { min-height: 44px; } }
  .reader-controls { position: sticky; top: -6px; z-index: 4; background: #121214; padding-bottom: 4px; }
  .reader-command-row, .reader-commands, .player-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .reader-command-row { justify-content: space-between; }
  .reader-commands { font-size: 12px; position: relative; }
  .reader-commands .dw-segmented { margin: 0; }
  .reader-commands .dw-segmented button { font-size: 12px; padding: 2px 4px; }
  .player-row { flex-wrap: nowrap; }
  .player-row audio { flex: 1; min-width: 80px; margin: 0; }
  .speed, .follow { display: flex; align-items: center; gap: 4px; font-size: 12px; white-space: nowrap; }
  .speed select { background: #27272a; color: inherit; border: 1px solid var(--dw-border); padding: 4px; border-radius: 4px; }
  .cue { cursor: text; }
  button.cue-time { border: 0; background: transparent; color: var(--dw-accent-bright); cursor: pointer; align-self: start; padding: 4px; font: inherit; font-size: 12px; }
  .cue-text { user-select: text; white-space: pre-wrap; }
  .more { position: static; }
  .more summary { cursor: pointer; list-style: none; }
  .more summary::-webkit-details-marker { display: none; }
  .more > summary { padding: 6px 8px; border-radius: 6px; color: var(--dw-text-muted); min-height: 36px; }
  .more[open] > summary, .more > summary:hover { color: var(--dw-text); background: var(--dw-bg-hover); }
  .mobile-playback { display: none; }
  .more-menu { position: absolute; right: 0; top: calc(100% + 4px); width: min(320px, calc(100vw - 40px)); max-height: min(620px, 55dvh); overflow-y: auto; overscroll-behavior: contain; border: 1px solid rgb(255 255 255 / 0.14); border-radius: 12px; background: #202023; padding: 6px; box-shadow: 0 12px 36px #0009, 0 2px 8px #0006; z-index: 6; overflow-wrap: anywhere; }
  .menu-group + .menu-group { border-top: 1px solid var(--dw-border); margin-top: 4px; padding-top: 4px; }
  .menu-action { display: grid; grid-template-columns: 18px minmax(0,1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 10px; border: 0; border-radius: 6px; background: transparent; color: var(--dw-text); font: inherit; font-size: 13px; line-height: 1.35; text-align: left; text-decoration: none; cursor: pointer; }
  .menu-action :global(> .dw-icon) { color: var(--dw-text-muted); }
  .menu-action:hover:not(:disabled) { background: var(--dw-bg-hover); }
  .menu-action:disabled { opacity: .45; cursor: not-allowed; }
  .menu-action.is-danger, .menu-action.is-danger :global(.dw-icon) { color: var(--dw-danger); }
  .menu-action.is-danger:hover:not(:disabled) { background: rgb(248 113 113 / .09); }
  .menu-action:focus-visible, .more > summary:focus-visible { outline: 2px solid var(--dw-accent-bright); outline-offset: -2px; }
  .processing-details[open] .disclosure-chevron { transform: rotate(90deg); }
  .processing-content { padding: 0 10px 10px 38px; color: var(--dw-text-muted); font-size: 12px; }
  .processing-content p + p { margin-top: 8px; }
  .mobile-playback { padding: 10px; }
  .more-menu summary, .more-menu p { white-space: normal; }
  .title-editor, .find-bar { padding: 8px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
  .title-editor label, .find-bar label { flex: 1; min-width: 140px; }
  .find-bar button { color: inherit; background: #27272a; border: 1px solid var(--dw-border); padding: 6px; border-radius: 4px; }
  .find-match { outline: 1px solid var(--dw-accent); border-radius: 4px; }
  .copy-success { position: absolute; right: 4px; top: 100%; background: #292922; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
  .original-status { font-size: 12px; }
  @media (hover: none), (pointer: coarse), (max-width: 959px) { .segment-copy { opacity: 1; } button.cue-time, .segment-copy { min-width: 44px; min-height: 44px; } .reader-command-row { align-items: start; } }
  @media (max-width: 599px) {
    .detail-tabs { gap: 2px; }
    .detail-tabs button { gap: 4px; padding-inline: 6px; font-size: 12px; }
    .player-row > .speed, .player-row > .follow { display: none; }
    .mobile-playback { display: flex; flex-wrap: wrap; gap: 12px; }
    .reader-commands > button, .reader-commands .dw-segmented button, .more > summary, .mobile-playback select { min-height: 44px; }
    .more > summary { display: flex; align-items: center; }
    .more-menu { right: 0; }
  }
</style>
