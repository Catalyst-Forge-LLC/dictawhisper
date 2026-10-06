<script>
  import { afterUpdate, createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { displayName, markPreview } from '../markPreview.js';
  import MayDoReview from './MayDoReview.svelte';
  export let connected = false, saveMayDoStatus, extractMayDos;
  import { stageCopy } from '../activityState.js';

  import { entryPresentation, transcriptPassages, activeMayDoCount, mayDoCounts, markEntryMatch, copyTranscriptText } from '../entryPresentation.js';
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
  let moreButton;
  let morePanel;
  let findButton;
  $: presentation = entryPresentation(transcription);
  $: original = !cleaned || showRaw;
  $: passages = transcriptPassages(transcription.transcriptionJson, original);
  $: if (matchCursor >= findMatches.length) matchCursor = -1;
  $: fullText = original ? String(transcription.transcriptionJson?.text || passages.map(row => row.text).join('\n\n')) : cleaned;
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
    reader?.addEventListener('wheel', manual, { passive: true });
    reader?.addEventListener('touchstart', manual, { passive: true });
    reader?.addEventListener('pointerdown', manual, { passive: true });
    reader?.addEventListener('keydown', manual);
    window.addEventListener('dw-recording-started', pause);
    return () => { window.removeEventListener('pointerdown', closeMore); window.removeEventListener('keydown', escapeMore); reader?.removeEventListener('wheel', manual); reader?.removeEventListener('touchstart', manual); reader?.removeEventListener('pointerdown', manual); reader?.removeEventListener('keydown', manual); window.removeEventListener('dw-recording-started', pause); };
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

  function audioUrl(jsonFile) {
    return `/audio?file=${encodeURIComponent(jsonFile)}`;
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
      ★
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
    <div class="note-body">
      <div class="reader-controls">
      <div class="reader-command-row">
      <div class="detail-tabs" role="group" aria-label="Entry sections">
        <button class:is-on={detailTab === 'transcript'} aria-pressed={detailTab === 'transcript'} on:click={() => chooseTab('transcript')}>Transcript</button>
        <button class:is-on={detailTab === 'maydos'} aria-pressed={detailTab === 'maydos'} on:click={() => chooseTab('maydos')} title="Count of Suggested and Selected actions; all saved actions are available here">MayDos <span>{activeMayDoCount(transcription.transcriptionJson)} / {mayDoCounts(transcription.transcriptionJson).mayDoTotalCount}</span>{#if transcription.transcriptionJson?.mayDoError} !{/if}</button>
        <button class:is-on={detailTab === 'tags'} aria-pressed={detailTab === 'tags'} on:click={() => chooseTab('tags')}>Tags <span>{tags.length}</span></button>
      </div>

      <div class="reader-commands">
        {#if detailTab === 'transcript'}<div class="dw-segmented" role="group" aria-label="Transcript view"><button disabled={!cleaned} aria-pressed={!original} class:is-on={!original} on:click={() => dispatch('raw', { jsonFile: transcription.jsonFile, show: false })}>Readable</button><button aria-pressed={original} class:is-on={original} on:click={() => dispatch('raw', { jsonFile: transcription.jsonFile, show: true })}>Original</button></div>{/if}
        <button class="dw-text-btn" aria-label="Copy full transcript" disabled={!fullText} on:click={copyFull}>Copy transcript</button>
        <button bind:this={findButton} class="dw-text-btn" on:click={openFind}>Find in entry</button>
        <details bind:open={moreOpen} class="more"><summary bind:this={moreButton}>More</summary><div class="more-menu" bind:this={morePanel}>
          <button class="dw-text-btn" on:click={beginTitleEdit}>Rename display title</button>
          <div class="mobile-playback"><label class="speed">Speed<select value={speed} on:change={event => setSpeed(event.target.value)} aria-label="Playback speed">{#each ['0.75','1','1.25','1.5','2'] as value}<option value={value}>{value}×</option>{/each}</select></label><label class="follow"><input type="checkbox" bind:checked={followAudio} />Follow audio</label></div>
          <a href={audioDownloadUrl(transcription.jsonFile)}>Download audio</a><a href={sidecarDownloadUrl(transcription.jsonFile)}>Export entry JSON</a>
          <details><summary>Processing details</summary><p>{presentation.path}</p><p>{presentation.dateLabel}{presentation.precision === 'month' ? ' · Month precision; no recording day is known.' : ''}</p>{#if presentation.sequence}<p>Recording {presentation.sequence}</p>{/if}{#if audioDuration != null}<p>Audio duration {formatTime(audioDuration)}</p>{/if}{#if transcription.transcriptionJson?.elapsed}<p>Processing time {transcription.transcriptionJson.elapsed}</p>{/if}{#if cleanedBy}<p>Cleaned {cleanedBy}</p>{/if}</details>
          {#if searchMatches.length}<p>{searchMatches.length} matching passages</p><button class="dw-text-btn" on:click={() => { stepSearch(-1); moreOpen = false; }}>Previous search match</button><button class="dw-text-btn" on:click={() => { stepSearch(1); moreOpen = false; }}>Next search match</button>{/if}
          <button class="dw-text-btn" disabled={busy} on:click={() => dispatch('retry', transcription.jsonFile)}>Reprocess readable transcript</button>
          <button class="dw-text-btn" disabled={busy} on:click={() => dispatch('skip', transcription.jsonFile)}>Skip cleanup</button>
          {#if holding || (unfiled && hasDateName(transcription.jsonFile))}<button class="dw-text-btn" disabled={busy} on:click={() => dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'rename' })}>Organize / resolve conflict…</button>{/if}
          {#if holding}<button class="dw-text-btn" disabled={busy} on:click={() => dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'unfile' })}>Move to Unfiled</button>{/if}
          <button class="dw-text-btn" disabled={busy} on:click={() => dispatch('resolve', {jsonFile:transcription.jsonFile})}>Assign recording date…</button>
          <button class="dw-text-btn" disabled={busy} on:click={() => dispatch('delete', transcription.jsonFile)}>Move to Trash</button>
        </div></details>
      </div></div>
      <div class="player-row"><audio bind:this={audioElement} data-position-restored={audioRestored} controls preload="metadata" on:loadedmetadata={restoreAudio} on:error={playbackFailed} src={audioUrl(transcription.jsonFile)} on:timeupdate={updateAudio} on:play={() => { for (const audio of document.querySelectorAll('audio')) if (audio !== audioElement) audio.pause(); }}></audio>
      <label class="speed">Speed<select value={speed} on:change={event => setSpeed(event.target.value)} aria-label="Playback speed">{#each ['0.75','1','1.25','1.5','2'] as value}<option value={value}>{value}×</option>{/each}</select></label><label class="follow"><input type="checkbox" bind:checked={followAudio} />Follow audio</label></div>
      {#if playError}<p class="dw-error" role="alert">{playError} <button class="dw-text-btn" on:click={playAudio}>Play audio</button></p>{/if}
      {#if copiedSegment || copyError}<p role={copyError ? 'alert' : 'status'} class:dw-error={copyError} class:copy-success={!copyError}>{copyError || (copiedSegment === 'full' ? 'Transcript copied' : 'Passage copied')}</p>{/if}
      {#if titleEditing}<form class="title-editor" on:submit|preventDefault={renameTitle}><label>Display title<input class="dw-input" maxlength="160" bind:this={titleInput} bind:value={titleDraft} placeholder={presentation.title} /></label><button class="dw-btn-secondary dw-btn-compact" disabled={titleSaving}>Save title</button><button type="button" class="dw-text-btn" on:click={() => titleEditing = false}>Cancel</button><p class="dw-muted">Leave blank to use the filename title. Files keep their names.</p>{#if titleError}<p class="dw-error" role="alert">{titleError}</p>{/if}</form>{/if}
      {#if findOpen}<div class="find-bar"><label>Find in entry<input class="dw-input" bind:this={findInput} bind:value={findQuery} on:input={() => matchCursor = -1} on:keydown={event => { if (event.key === 'Enter') stepMatch(event.shiftKey ? -1 : 1); if (event.key === 'Escape') { findOpen = false; findButton?.focus(); } }} /></label><span role="status">{findMatches.length ? (matchCursor < 0 ? `${findMatches.length} matches` : `${matchCursor + 1} of ${findMatches.length} matches`) : '0 matches'}</span><button disabled={!findMatches.length} on:click={() => stepMatch(-1)}>Previous match</button><button disabled={!findMatches.length} on:click={() => stepMatch(1)}>Next match</button><button on:click={() => { findOpen = false; findButton?.focus(); }}>Close find</button></div>{/if}
      </div>

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
        <div class="cue-row" class:find-match={findMatches[matchCursor]?.index === index}>
          <div id={`cue-${index}`} class="cue" class:is-active={cueActive(transcription, cue, index, playTime)}>
            {#if cueHasTime(cue)}<button class="cue-time" aria-label={`Play passage at ${formatTime(cue.start)}`} on:click={event => playCue(event, cue)}>{formatTime(cue.start)}</button>{:else}<span class="cue-time" aria-label="No timing available">—</span>{/if}
            <div class="cue-text">{@html markEntryMatch(cue.text, findOpen ? findQuery : '')}</div>
          </div>
          <button class="segment-copy" aria-label="Copy passage" title="Copy passage" on:click={() => copySegment(cue.text, 'cue-' + index)}>{copiedSegment === 'cue-' + index ? '✓' : '⧉'}</button>
        </div>
      {:else}<p class="dw-muted">No transcript text is available.</p>{/each}

      {/if}

    </div>
  {/if}
</article>

<style lang="scss">
  .detail-tabs { display: flex; gap: 0.3rem; margin-bottom: 0.45rem; }
  .detail-tabs button { border: 1px solid transparent; border-radius: 0.4rem; background: transparent; color: var(--dw-text-muted); font: inherit; font-size: 0.8125rem; padding: 0.3rem 0.55rem; cursor: pointer; }
  .detail-tabs button.is-on { border-color: var(--dw-border); background: rgb(245 158 11 / 0.08); color: var(--dw-accent-bright); }
  .detail-tabs span { margin-left: 0.25rem; font-size: 0.7rem; }
  .note.is-selected { border-color: var(--dw-accent); background: rgb(245 158 11 / 0.08); }
  .maydo-badge { margin-top: 0.45rem; color: var(--dw-accent-bright); }
  .cue-row { position: relative; padding-right: 2.1rem; }
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
  .more summary { cursor: pointer; }
  .mobile-playback { display: none; }
  .more-menu { position: absolute; right: 0; top: 100%; width: min(300px, 70vw); max-height: 45dvh; overflow-y: auto; border: 1px solid var(--dw-border); border-radius: 8px; background: #242427; padding: 12px; display: flex; flex-direction: column; gap: 12px; z-index: 6; overflow-wrap: anywhere; }
  .more-menu a { color: var(--dw-text); text-decoration: underline; text-underline-offset: 3px; }
  .more-menu summary, .more-menu p { white-space: normal; }
  .title-editor, .find-bar { padding: 8px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
  .title-editor label, .find-bar label { flex: 1; min-width: 140px; }
  .find-bar button { color: inherit; background: #27272a; border: 1px solid var(--dw-border); padding: 6px; border-radius: 4px; }
  .find-match { outline: 1px solid var(--dw-accent); border-radius: 4px; }
  .copy-success { position: absolute; right: 4px; top: 100%; background: #292922; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
  .original-status { font-size: 12px; }
  @media (hover: none), (pointer: coarse), (max-width: 959px) { .segment-copy { opacity: 1; } button.cue-time, .segment-copy { min-width: 44px; min-height: 44px; } .reader-command-row { align-items: start; } }
  @media (max-width: 599px) {
    .player-row > .speed, .player-row > .follow { display: none; }
    .mobile-playback { display: flex; flex-wrap: wrap; gap: 12px; }
    .reader-commands > button, .reader-commands .dw-segmented button, .more > summary, .mobile-playback select { min-height: 44px; }
    .more > summary { display: flex; align-items: center; }
    .more-menu { right: 0; width: min(300px, calc(100vw - 48px)); }
  }
</style>
