<script>
  import { onMount, tick } from 'svelte';
  export let open = false;
  let panel;
  let priorFocus;
  async function close() {
    open = false;
    await tick();
    priorFocus?.focus({ preventScroll: true });
  }
  $: if (open && typeof window !== 'undefined' && window.innerWidth < 1200) {
    priorFocus = document.activeElement;
    tick().then(() => panel?.querySelector('button')?.focus());
  }
  onMount(() => {
    const wide = window.matchMedia('(min-width: 1200px)');
    const resize = () => {
      if (!wide.matches) {
        if (panel?.contains(document.activeElement)) document.querySelector('[aria-controls="library-navigation"]')?.focus({ preventScroll: true });
        open = false;
      }
    };
    wide.addEventListener('change', resize);
    return () => wide.removeEventListener('change', resize);
  });
  function keyboard(event) {
    if (!open || window.innerWidth >= 1200) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button, input, select, a[href]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
</script>
<svelte:window on:keydown={keyboard} />
{#if open}
  <button class="scrim" aria-label="Close library navigation" tabindex="-1" on:click={close}></button>
  <aside id="library-navigation" class="library" aria-label="Library navigation" bind:this={panel}>
    <button class="drawer-close dw-btn-secondary dw-btn-compact" on:click={close}>Close library</button>
    <slot />
  </aside>
{/if}
<style>
  .library { min-height: 0; overflow-y: auto; padding: 12px; border: 1px solid var(--dw-border); border-radius: 8px; background: #18181b; }
  .scrim, .drawer-close { display: none; }
  @media (max-width: 1199px) {
    .scrim { display: block; position: fixed; inset: 0; z-index: 29; background: #0009; border: 0; }
    .library { position: fixed; z-index: 30; top: 56px; bottom: 8px; left: 8px; width: min(300px, calc(100vw - 16px)); }
    .drawer-close { display: inline-flex; margin-bottom: 12px; }
  }
</style>
