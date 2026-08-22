<script>
  import { createEventDispatcher } from 'svelte';
  import { displayName, markPreview } from '../markPreview.js';

  export let transcription;
  export let variant = 'note';
  export let query = '';
  export let selectedTags = [];
  export let expanded = false;
  export let showRaw = false;
  export let busy = false;
  export let playing = false;

  const dispatch = createEventDispatcher();
  let tagDraft = '';

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

  $: cleaned = cleanedOf(transcription);
  $: tags = tagsOf(transcription);
  $: starred = isStarred(transcription);
  $: holding = folderOf(transcription.jsonFile) === 'holding';
  $: unfiled = folderOf(transcription.jsonFile) === 'unfiled';
  $: tagFieldId = `tag-${String(transcription.jsonFile || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
</script>

<article
  class="note dw-card dw-card-hover"
  class:is-open={expanded}
  class:is-playing={playing}
  class:is-hit={variant === 'hit'}
>
  <div class="note-top">
    <button
      type="button"
      class="note-head"
      title={transcription.jsonFile}
      on:click={() => dispatch('toggle', transcription.jsonFile)}
    >
      <span class="note-title">
        <span class="name">{displayName(transcription.jsonFile)}</span>
        {#if variant === 'hit' && transcription.day}
          <span class="day">{transcription.day}</span>
        {/if}
        {#if transcription.transcriptionJson?.elapsed}
          <span class="elapsed">{transcription.transcriptionJson.elapsed}</span>
        {/if}
        {#if transcription.transcriptionJson?.cleanupSkipped}
          <span class="status">cleanup skipped</span>
        {:else if !cleaned}
          <span class="status">{transcription.transcriptionJson?.cleanupError ? 'cleanup failed' : 'raw only'}</span>
        {/if}
      </span>
      {#if !expanded}
        <span class="preview">
          {#if variant === 'hit' && query.trim()}
            {@html markPreview(
              preview(cleaned || transcription.transcriptionJson?.preview || transcription.transcriptionJson?.text || ''),
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

  {#if tags.length || expanded}
    <div class="note-tags">
      {#each tags as tag}
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

  {#if expanded}
    <div class="note-body">
      <audio
        controls
        preload="metadata"
        src={audioUrl(transcription.jsonFile)}
        on:timeupdate={(event) => dispatch('time', { item: transcription, event })}
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
        {#if !showRaw}
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
          <button type="button" class:is-on={!showRaw} on:click={() => dispatch('raw', { jsonFile: transcription.jsonFile, show: false })}>
            Readable
          </button>
          <button type="button" class:is-on={showRaw} on:click={() => dispatch('raw', { jsonFile: transcription.jsonFile, show: true })}>
            Raw
          </button>
        </div>
        {#if showRaw}
          <div class="segments">
            {#each transcription.transcriptionJson.segments as segment}
              <p>
                <span class="times">{formatTime(segment.start)}–{formatTime(segment.end)}</span>
                {segment.text}
              </p>
            {/each}
          </div>
        {/if}
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

      <div class="actions">
        <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => dispatch('copy', transcription)}>
          Copy
        </button>
        <a class="dw-btn-secondary dw-btn-compact" href={audioDownloadUrl(transcription.jsonFile)}>Audio</a>
        <a class="dw-btn-secondary dw-btn-compact" href={sidecarDownloadUrl(transcription.jsonFile)}>Sidecar</a>
        {#if !cleaned || transcription.transcriptionJson?.cleanupError || transcription.transcriptionJson?.cleanupSkipped}
          <button
            type="button"
            class="dw-btn-secondary dw-btn-compact"
            disabled={busy}
            on:click={() => dispatch('retry', transcription.jsonFile)}
          >
            Retry
          </button>
          <button
            type="button"
            class="dw-btn-secondary dw-btn-compact"
            disabled={busy}
            on:click={() => dispatch('skip', transcription.jsonFile)}
          >
            Skip
          </button>
        {/if}
        {#if holding || (unfiled && hasDateName(transcription.jsonFile))}
          {#if hasDateName(transcription.jsonFile)}
            <button
              type="button"
              class="dw-btn-secondary dw-btn-compact"
              disabled={busy}
              on:click={() => dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'overwrite' })}
            >
              File
            </button>
            <button
              type="button"
              class="dw-btn-secondary dw-btn-compact"
              disabled={busy}
              on:click={() => dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'rename' })}
            >
              File as copy
            </button>
          {/if}
          {#if holding}
            <button
              type="button"
              class="dw-btn-secondary dw-btn-compact"
              disabled={busy}
              on:click={() => dispatch('resolve', { jsonFile: transcription.jsonFile, action: 'unfile' })}
            >
              Unfile
            </button>
          {/if}
        {/if}
        <button
          type="button"
          class="dw-btn-secondary dw-btn-compact is-danger"
          on:click={() => dispatch('delete', transcription.jsonFile)}
        >
          Delete
        </button>
      </div>
    </div>
  {/if}
</article>

<style lang="scss">
  .note {
    position: relative;
    padding: 0.85rem 1rem;
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
  .elapsed,
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

  .tag-edit {
    margin-top: 0.85rem;
  }

  .tag-row {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.35rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.85rem;
  }

  .actions a {
    text-decoration: none;
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
</style>
