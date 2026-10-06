<script>
  import { tick, createEventDispatcher } from 'svelte';
  import MayDoBackfill from './MayDoBackfill.svelte';
  export let open = false, connected = false;
  const dispatch = createEventDispatcher();
  let dialog, priorFocus;
  $: if (dialog && open && !dialog.open) { priorFocus = document.activeElement; dialog.showModal(); tick().then(() => dialog.querySelector('button')?.focus()); }
  $: if (dialog && !open && dialog.open) { dialog.close(); priorFocus?.focus({ preventScroll: true }); }
</script>
<dialog bind:this={dialog} aria-label="Extract MayDos from older entries" on:cancel|preventDefault={() => open = false}>
  <header><h2>MayDo extraction</h2><button class="dw-btn-secondary" on:click={() => open = false}>Close extraction</button></header>
  {#if open}<MayDoBackfill {connected} on:change={event => dispatch('change', event.detail)} />{/if}
</dialog>
<style>dialog {position:fixed;inset:0 0 0 auto;margin:0;width:min(480px,100vw);max-width:100vw;height:100dvh;max-height:100dvh;padding:16px;background:#18181b;color:var(--dw-text);border:0;border-left:1px solid var(--dw-border);overflow:auto;} dialog::backdrop {background:#0008;} header {display:flex;justify-content:space-between;align-items:center;gap:8px;} h2 {font-size:18px;} button {min-height:44px;}</style>
