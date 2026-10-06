<script>
  import { createEventDispatcher } from 'svelte';
  export let title = '';
  export let dateLabel = '';
  export let starred = false;
  export let busy = false;
  export let previousDisabled = false;
  export let nextDisabled = false;
  export let heading;
  export let scrollElement;
  const dispatch = createEventDispatcher();
</script>
<section class="detail-pane" aria-label="Selected entry detail">
  <header class="detail-head">
    <div class="title-row"><div class="identity"><h2 bind:this={heading} tabindex="-1" title={title} aria-live="polite" aria-atomic="true">{title}</h2>{#if dateLabel}<p class="recording-date">{dateLabel}</p>{/if}</div><button class="star dw-btn-secondary dw-btn-compact" aria-label={starred ? 'Unstar note' : 'Star note'} aria-pressed={starred} disabled={busy} on:click={() => dispatch('star')}>★</button></div>
    <div class="reader-navigation"><button class="dw-btn-secondary dw-btn-compact" disabled={previousDisabled} title={previousDisabled ? 'No previous entry in the available results' : 'Previous entry'} on:click={() => dispatch('previous')}>Previous</button><button class="dw-btn-secondary dw-btn-compact" disabled={nextDisabled} title={nextDisabled ? 'No next entry in the current results' : 'Next entry'} on:click={() => dispatch('next')}>Next</button><button class="close dw-btn-secondary dw-btn-compact" on:click={() => dispatch('close')}>Back to entries</button></div>
  </header>
  <div class="detail-scroll" bind:this={scrollElement} on:scroll><slot /></div>
</section>
<style>
  .detail-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--dw-border); border-radius: 8px; background: #121214; }
  .identity { flex: 1; min-width: 0; }
  .recording-date { line-height: 14px; font-size: 12px; color: var(--dw-text-muted); flex-basis: 100%; }
  .detail-head { flex-wrap: wrap; flex-shrink: 0; padding: 4px 12px; display: flex; gap: 8px; align-items: start; border-bottom: 1px solid var(--dw-border); }
  .title-row { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: start; }
  h2 { flex: 1; min-width: 0; font-size: 16px; line-height: 18px; font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .star { flex-shrink: 0; }
  .star[aria-pressed='true'] { color: var(--dw-accent-bright); }
  .reader-navigation { display: flex; gap: 8px; margin-top: 0; }
  .close { margin-left: auto; }
  .detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 12px; }
  @media (max-width: 1199px) { .detail-head { display: block; } .reader-navigation { margin-top: 4px; } }
  @media (max-width: 959px), (pointer: coarse) { button { min-height: 44px; } }
</style>
