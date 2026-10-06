<script>
  import { afterUpdate, onMount, tick } from 'svelte';
  import { heightAt, virtualSlice } from '../virtualWindow.js';

  export let items = [];
  export let estimate = 108;
  export let layoutKey = '';
  const measurementKey = (key, context) => JSON.stringify([context, key]);
  export let overscan = 8;
  export let getKey = (item) => item.jsonFile;

  let root;
  let scrollRoot;
  let scrollTop = 0;
  let viewport = 640;
  let heights = {};
  export async function scrollToIndex(index, offset = 0) {
    if (!scrollRoot || index < 0) return;
    const base = root.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop;
    let top = 0;
    for (let row = 0; row < index; row += 1) top += heightAt(sizes, row, estimate);
    scrollRoot.scrollTop = base + top + offset;
    onScroll();
    await tick();
  }
  // Preserve measurements when hydration or filtering replaces the item array.
  $: sizes = Object.fromEntries(items.map((item, index) => [index, heights[measurementKey(getKey(item, index), layoutKey)]]));

  function measure(node, key) {
    const write = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0 && heights[key] !== height) {
        heights[key] = height;
        heights = heights;
      }
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return {
      update(next) {
        key = next;
        write();
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  function onScroll() {
    if (!root) return;
    const offset = scrollRoot
      ? root.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop
      : root.getBoundingClientRect().top + window.scrollY;
    scrollTop = Math.max(0, (scrollRoot ? scrollRoot.scrollTop : window.scrollY) - offset);
    viewport = scrollRoot ? scrollRoot.clientHeight : window.innerHeight;
  }

  afterUpdate(onScroll);

  $: slice =
    items.length <= 16
      ? { start: 0, end: items.length, startTop: 0, total: 0 }
      : virtualSlice({
          count: items.length,
          scrollTop,
          viewport,
          sizes,
          estimate,
          overscan,
        });
  $: windowed = (() => {
    let top = slice.startTop;
    return items.slice(slice.start, slice.end).map((item, offset) => {
      const index = slice.start + offset;
      const row = { item, index, key: getKey(item, index), top };
      top += heightAt(sizes, index, estimate);
      return row;
    });
  })();
  $: tall = items.length > 16;

  onMount(() => {
    scrollRoot = root?.closest('.entry-scroll') || root?.closest('.dw-main') || null;
    const target = scrollRoot || window;
    onScroll();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });
</script>

<div class="virt-root" bind:this={root}>
  {#if !tall}
    {#each items as item, index (getKey(item, index))}
      <slot {item} {index} />
    {/each}
  {:else}
    <div class="virt" style="height: {slice.total}px">
      {#each windowed as row (row.key)}
        <div class="virt-row" style="transform: translateY({row.top}px)" use:measure={measurementKey(row.key, layoutKey)}>
          <slot item={row.item} index={row.index} />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .virt-root {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .virt {
    position: relative;
  }

  .virt-row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding-bottom: 0.5rem;
  }
</style>
