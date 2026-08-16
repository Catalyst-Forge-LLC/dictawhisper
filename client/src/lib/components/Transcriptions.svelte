<script>
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
  const TAG_CLOUD_CAP = 40;

  function folderOf(jsonFile) {
    const norm = String(jsonFile || '').replace(/\\/g, '/');
    const inPath = norm.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
    if (inPath) return { year: inPath[1], month: inPath[2], key: `${inPath[1]}-${inPath[2]}` };
    const base = norm.split('/').pop() || '';
    const inName = base.match(/^(\d{4})-(\d{2})-\d{2}/);
    if (inName) return { year: inName[1], month: inName[2], key: `${inName[1]}-${inName[2]}` };
    return { year: null, month: null, key: 'other' };
  }

  function groupLabel(group) {
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
    return String(item.transcriptionJson?.cleanedTranscription || '').trim();
  }

  function preview(text, limit = 200) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= limit) return oneLine;
    return `${oneLine.slice(0, limit)}…`;
  }

  function paragraphs(text) {
    return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  }

  function cuesOf(item) {
    const cues = item.transcriptionJson?.playbackCues;
    if (Array.isArray(cues) && cues.length) return cues;
    const cleaned = cleanedOf(item);
    return cleaned ? paragraphs(cleaned).map((text) => ({ text, start: 0, end: 0 })) : [];
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

  function playCue(event, start) {
    const article = event.currentTarget.closest('.note');
    const audio = article?.querySelector('audio');
    if (!audio) return;
    audio.currentTime = Math.max(0, Number(start) || 0);
    audio.play();
  }

  function cueActive(item, cue, index) {
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
    const dated = [...map.values()].filter((group) => group.key !== 'other');
    dated.sort((a, b) => b.key.localeCompare(a.key));
    const other = map.get('other');
    return other ? [...dated, other] : dated;
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

  function matchesTags(item) {
    if (!selectedTags.length) return true;
    const have = new Set(tagsOf(item));
    return selectedTags.every((tag) => have.has(tag));
  }

  function toggleTag(tag) {
    selectedTags = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
  }

  $: visible = transcriptions.filter(matchesTags);
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
  $: newestKey = groups[0]?.key;

  function isOpen(key) {
    if (Object.prototype.hasOwnProperty.call(openGroups, key)) return openGroups[key];
    return key === newestKey;
  }

  function onToggle(key, event) {
    openGroups[key] = event.currentTarget.open;
    openGroups = openGroups;
  }

  function toggleExpanded(jsonFile) {
    expanded[jsonFile] = !expanded[jsonFile];
    expanded = expanded;
  }

  function deleteTranscription(jsonFile) {
    if (confirm('Are you sure you want to delete this transcription?')) {
      transcriptions = transcriptions.filter((transcription) => transcription.jsonFile !== jsonFile);
      socket.emit('delete-transcription', { jsonFile });
    }
  }

  function copyTranscription(transcription) {
    const json = transcription.transcriptionJson || {};
    const text =
      json.cleanedTranscription ||
      (json.segments || []).map((segment) => segment.text).join('\n');
    navigator.clipboard.writeText(text);
  }

  socket.on('transcription', (data) => {
    const i = transcriptions.findIndex((t) => t.jsonFile === data.jsonFile);
    if (i >= 0) {
      transcriptions[i] = data;
      transcriptions = transcriptions;
    } else {
      transcriptions = [...transcriptions, data];
    }
  });
</script>

<section class="transcriptions">
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
      </div>
    </details>
  {/if}

  {#if selectedTags.length && !visible.length}
    <p class="empty">No notes match {selectedTags.join(' + ')}.</p>
  {/if}

  {#each groups as group}
    <details class="folder" open={isOpen(group.key)} on:toggle={(event) => onToggle(group.key, event)}>
      <summary>
        <span class="folder-name">{groupLabel(group)}</span>
        <span class="folder-count">{group.items.length}</span>
      </summary>
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
              {#if !cleaned}
                <span class="status">{transcription.transcriptionJson?.cleanupError ? 'cleanup failed' : 'raw only'}</span>
              {/if}
            </div>
            {#if tags.length}
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
              <p class="preview">{cleaned ? preview(cleaned) : preview(transcription.transcriptionJson?.text || '')}</p>
            {/if}
          </header>
          <div class="actions">
            <button type="button" on:click={() => deleteTranscription(transcription.jsonFile)}>DEL</button>
            <button type="button" on:click={() => copyTranscription(transcription)}>COPY</button>
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
                {#each cuesOf(transcription) as cue, index}
                  <button
                    type="button"
                    class="cue"
                    class:active={cueActive(transcription, cue, index)}
                    on:click={(event) => playCue(event, cue.start)}
                  >
                    <span class="cue-time">{formatTime(cue.start)}</span>
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
    </details>
  {/each}
</section>

<style lang="scss">
  .transcriptions {
    padding: 0.5rem 0 1.5rem;
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
    white-space: nowrap;
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
