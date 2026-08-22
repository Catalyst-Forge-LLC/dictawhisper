<script>
  import { createEventDispatcher, onMount } from 'svelte';

  export let open = false;

  const dispatch = createEventDispatcher();

  function close() {
    open = false;
    dispatch('close');
  }

  function onKey(event) {
    if (event.key === 'Escape' && open) close();
  }

  onMount(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if open}
  <div class="dimmer" on:click={close} on:keydown={(event) => event.key === 'Enter' && close()} role="presentation"></div>
  <aside class="dw-card-elevated drawer" role="dialog" aria-labelledby="help-title">
    <div class="drawer-head">
      <h2 id="help-title">DictaWhisper</h2>
      <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={close}>Close</button>
    </div>
    <p>Record or drop an audio file. Browser clips start immediately. Phone-folder watches wait until the file has settled, then file into <code>YYYY/MM/</code>.</p>
    <p>Cleaned text and tags are the default view. Retry cleanup if ollanet was unreachable; Skip leaves the raw transcript. Holding notes can File, File as copy, or Unfile.</p>
    <p>Search the inbox by words, tags, or filename. Tools shows queues, health checks, and a probe for broken audio. First-run problems: <code>pnpm run doctor</code>.</p>
  </aside>
{/if}

<style lang="scss">
  .dimmer {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 0.5);
  }

  .drawer {
    position: fixed;
    top: 0.75rem;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 50;
    width: min(24rem, calc(100vw - 1.5rem));
    overflow: auto;
    padding: 1.25rem;
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  p {
    margin: 0 0 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: rgb(212 212 216);
  }

  code {
    font-size: 0.9em;
    background: rgb(255 255 255 / 0.06);
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
  }
</style>
