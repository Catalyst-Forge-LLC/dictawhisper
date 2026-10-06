<script>
  export let hiddenOnMobile = false;
  export let scrollElement;
  export let loading = false;
</script>
<section class="list-pane" class:hiddenOnMobile aria-label="Entry list">
  <div class="search-pane"><slot name="search" /></div>
  <div class="entry-scroll" bind:this={scrollElement} on:scroll role="region" aria-label="Entry cards" aria-busy={loading}><slot /></div>
  <div class="paging"><slot name="paging" /></div>
</section>
<style>
  .paging { flex-shrink: 0; }
  .list-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .search-pane { flex: 0 1 auto; overflow-y: auto; max-height: 50%; }
  .entry-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-anchor: none; }
  @media (max-width: 959px) { .hiddenOnMobile { display: none; } }
</style>
