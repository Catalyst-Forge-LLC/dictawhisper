<script>
  import { onMount, tick } from 'svelte';
  import { anchorIndex } from '../workspaceState.js';
  import { entryPresentation } from '../entryPresentation.js';
  import NoteCard from './NoteCard.svelte';
  import VirtualList from './VirtualList.svelte';

  export let items = [];
  export let activityItems = [];
  export let variant = 'note';
  export let compact = false;
  let layoutKey = '';
  let measuredWidth = 0;
  export let query = '';
  export let selectedTags = [];
  export let selectedFile = '';
  export let showRaw = {};
  export let noteBusy = {};
  export let landFile = '';
  export let landCue = null;
  let container;
  let virtual;
  let columns = 1;
  let lastAnchor;
  let restoringAnchor;
  let restoration = 0;
  function entryNode(file) {
    return [...(container?.querySelectorAll('[data-entry-key]') || [])].find(node => node.dataset.entryKey === file);
  }
  export function captureAnchor(preferredFile = '') {
    const scroller = container?.closest('.entry-scroll');
    if (!scroller || scroller.clientHeight === 0) return null;
    const top = scroller.getBoundingClientRect().top;
    const preferred = entryNode(preferredFile);
    const inView = preferred && preferred.getBoundingClientRect().bottom > top && preferred.getBoundingClientRect().top < top + scroller.clientHeight;
    const node = (inView ? preferred : null) || [...container.querySelectorAll('[data-entry-key]')]
      .find(item => item.getBoundingClientRect().bottom > top);
    if (node) lastAnchor = { key: node.dataset.entryKey, offset: top - node.getBoundingClientRect().top };
    return node ? lastAnchor : null;
  }
  export async function restoreAnchor(anchor) {
    const request = ++restoration;
    lastAnchor = anchor;
    restoringAnchor = anchor;
    const index = anchorIndex(rows, anchor.key);
    if (index < 0) return;
    await virtual.scrollToIndex(index, anchor.offset);
    // Measuring newly mounted rows can change the virtual offset. Correct after
    // those measurements, rather than racing the browser's next layout frame.
    for (let pass = 0; pass < 3; pass += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      await tick();
      if (request !== restoration) return;
      const node = entryNode(anchor.key);
      const scroller = container?.closest('.entry-scroll');
      if (node && scroller) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + anchor.offset;
    }
    if (request === restoration) restoringAnchor = null;
  }
  export function focusEntry(file) {
    const button = entryNode(file)?.querySelector('.note-head');
    if (!button) return false;
    button.focus({ preventScroll: true });
    return true;
  }
  $: titleCounts = items.reduce((counts, item) => { const value = entryPresentation(item); const key = `${value.title}:${value.dateLabel}`; counts[key] = (counts[key] || 0) + 1; return counts; }, {});
  $: rows = Array.from({ length: Math.ceil(items.length / columns) }, (_, index) => items.slice(index * columns, (index + 1) * columns));
  onMount(() => {
    const observer = new ResizeObserver(() => {
      const next = compact ? 1 : Math.max(1, Math.min(3, Math.floor((container.clientWidth + 8) / 288)));
      const width = Math.round(container.clientWidth);
      if (next === columns && measuredWidth === width) return;
      measuredWidth = width;
      layoutKey = `${next}:${width}`;
      const cached = restoringAnchor || lastAnchor;
      const anchor = cached && anchorIndex(rows, cached.key) >= 0 ? cached : captureAnchor(selectedFile);
      columns = next;
      if (anchor) void tick().then(() => restoreAnchor(anchor));
    });
    observer.observe(container);
    return () => observer.disconnect();
  });
</script>

<div class="card-grid" bind:this={container}>
<VirtualList {layoutKey} bind:this={virtual} items={rows} getKey={row => row.map(item => item.jsonFile).join('|')} estimate={140} let:item={row}>
<div class="card-row" style={`grid-template-columns: repeat(${columns}, minmax(0, 1fr))`}>
{#each row as item (item.jsonFile)}
  <NoteCard
    activityItem={activityItems.find(activity=>activity.jsonFile===item.jsonFile)}
    transcription={item}
    disambiguate={titleCounts[`${entryPresentation(item).title}:${entryPresentation(item).dateLabel}`] > 1}
    {variant}
    {query}
    {selectedTags}
    selected={selectedFile === item.jsonFile}
    showRaw={!!showRaw[item.jsonFile]}
    busy={!!noteBusy[item.jsonFile]}
    playing={selectedFile === item.jsonFile && typeof item.transcriptionJson?._currentTime === 'number'}
    landCue={landFile === item.jsonFile ? landCue : null}
    on:toggle
    on:star
    on:tag
    on:savetags
    on:raw
    on:time
    on:copy
    on:retry
    on:skip
    on:resolve
    on:delete
  />
{/each}
</div>
</VirtualList>
</div>

<style>
  .card-grid { min-width: 0; }
  .card-row { display: grid; gap: 8px; align-items: start; padding-bottom: 0; }
</style>
