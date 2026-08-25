<script>
  import { onMount } from 'svelte';
  import { heightAt, virtualSlice } from '../virtualWindow.js';

  export let items = [];
  export let estimate = 108;
  export let overscan = 8;
  export let getKey = (item) => item.jsonFile;

  let root;
  let scrollRoot;
  let scrollTop = 0;
  let viewport = 640;
  let sizes = {};

  function measure(node, index) {
    const write = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0 && sizes[index] !== height) {
        sizes[index] = height;
        sizes = sizes;
      }
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return {
      update(next) {
        index = next;
        write();
      },
      destroy() {
        observer.disconnect();
      },
    };
  }

  function onScroll() {
    scrollTop = scrollRoot ? scrollRoot.scrollTop : window.scrollY;
    viewport = scrollRoot ? scrollRoot.clientHeight : window.innerHeight;
  }

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
    scrollRoot = root?.closest('.dw-main') || null;
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
        <div class="virt-row" style="transform: translateY({row.top}px)" use:measure={row.index}>
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
