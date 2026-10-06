<script>
  import { onMount, onDestroy, tick, createEventDispatcher } from 'svelte';
  import { mayDoCounts, MAY_DO_PRIMARY, MAY_DO_STATUSES } from '../../../../src/shared/mayDoState.ts';
  import { copyTranscriptText } from '../entryPresentation.js';
  export let json, file, connected = false, saveStatus, extract, playSource;
  const dispatch = createEventDispatcher();
  let mounted = false, capabilities = null, capabilityError = '', extracting = false, error = '', statusError = '', busy = {}, rowErrors = {}, undo = null, timer, root, message = '';
  $: counts = mayDoCounts(json);
  $: readable = Boolean(String(json?.cleanedTranscription || json?.text || '').trim()) && !json?.audioError;
  $: groups = ['selected', 'suggested', 'done', 'dismissed'].map(status => ({ status, rows: (json?.mayDos || []).filter(row => row.status === status) }));
  $: state = error || json?.mayDoError ? 'error' : json?.mayDoState || (json?.mayDoExtraction ? 'current' : 'none');
  onMount(() => { mounted = true; });
  $: if (mounted && connected) void checkCapabilities();
  onDestroy(() => clearTimeout(timer));
  async function checkCapabilities() {
    capabilityError = '';
    try { const res = await fetch('/notes/may-dos/capabilities'); if (!res.ok) throw new Error(); capabilities = await res.json(); }
    catch { capabilityError = 'Extraction availability could not be checked.'; }
  }
  async function change(row, status, restoring = false) {
    if (!connected || busy[row.id]) return;
    const previous = row.status; statusError = ''; busy = { ...busy, [row.id]: true }; rowErrors = { ...rowErrors, [row.id]: '' };
    try {
      await saveStatus(file, row.id, status, previous);
      clearTimeout(timer);
      undo = restoring ? null : { id: row.id, title: row.title, status: previous, expected: status };
      if (undo) timer = setTimeout(() => undo = null, 5000);
      message = `${row.title}: ${status}.`;
      busy = { ...busy, [row.id]: false };
      await tick();
      const next = [...root.querySelectorAll('[data-action-id]')].find(button => button.dataset.actionId === row.id && button.getClientRects().length);
      (next || root.querySelector('.undo-button'))?.focus({ preventScroll: true });
    } catch (e) { const reason = e.message || 'Could not save this action. Try again.'; rowErrors = { ...rowErrors, [row.id]: reason }; if (restoring) statusError = reason; }
    finally { busy = { ...busy, [row.id]: false }; }
  }
  async function extractActions() {
    error = ''; message = ''; extracting = true;
    try { await extract(file); message = 'MayDos updated. Your selected actions were kept.'; }
    catch(e) { error = e.message || 'Extraction failed. Saved actions were kept.'; }
    finally { extracting = false; }
  }
  async function copyQuote(row) {
    const result = await copyTranscriptText(row.sourceQuote, navigator.clipboard);
    message = result.error ? 'Could not copy. Select the source quote and copy manually.' : 'Source quote copied.';
  }
  function hasTime(row) { return typeof row.start === 'number' && Number.isFinite(row.start) && row.start >= 0; }
</script>

<section bind:this={root} aria-label="Entry MayDos" class="review">
  <header><h3>MayDos · {counts.mayDoActiveCount} active / {counts.mayDoTotalCount} saved</h3>
    <button class="dw-btn-secondary" disabled={!connected || extracting || !readable || !capabilities?.available} on:click={extractActions}>{extracting ? 'Extracting…' : state === 'error' ? 'Retry extraction' : state === 'none' ? 'Extract MayDos' : 'Extract again'}</button>
  </header>
  {#if !connected}<p role="status">Reconnect to change or extract actions.</p>{/if}
  {#if !readable}<p class="dw-muted">No readable transcript is available for extraction. Saved actions remain available.</p>{/if}
  {#if capabilityError}<p role="alert">{capabilityError} <button on:click={checkCapabilities}>Check again</button></p>
  {:else if !capabilities}<p class="dw-muted">Checking extraction availability…</p>
  {:else if !capabilities.available}<p class="dw-muted">Extraction disabled. {capabilities.disabledReason} <button class="dw-text-btn" on:click={() => dispatch('configure')}>Configure cleanup</button></p>{/if}
  {#if state === 'stale'}<p role="status">Out of date · the transcript or extraction version changed. Extract again to refresh; your decided actions are kept.</p>{/if}
  {#if json?.mayDoError || error}<p role="alert" class="dw-error">{error || json.mayDoError} Saved actions were kept.</p>{/if}
  {#if !counts.mayDoTotalCount && state !== 'error'}<p class="dw-muted">{state === 'none' ? 'MayDos have not been extracted yet.' : 'No actions found in the last extraction.'}</p>{/if}
  {#if statusError}<p role="alert" class="dw-error">{statusError}</p>{/if}
  {#if undo}<p class="undo" role="status">Saved: {undo.title}. <button class="undo-button dw-btn-secondary" disabled={!connected || busy[undo.id]} on:click={() => change({ id: undo.id, title: undo.title, status: undo.expected }, undo.status, true)}>Undo</button></p>{/if}
  {#if message && !undo}<p class="dw-muted" role="status">{message}</p>{/if}
  {#each groups as group (group.status)}
    {#if group.rows.length}
      {#if group.status === 'done' || group.status === 'dismissed'}
        <details class="group"><summary>{group.status === 'done' ? 'Completed' : 'Dismissed'} · {group.rows.length}</summary>
          {#each group.rows as row (row.id)}{@const primary = MAY_DO_PRIMARY[row.status]}
            <article aria-label={row.title}>
              <strong>{row.title}</strong>
              <div class="actions"><button class="dw-btn-secondary" data-action-id={row.id} disabled={!connected || busy[row.id]} on:click={() => change(row, primary.status)}>{busy[row.id] ? 'Saving…' : primary.label}</button><details class="more"><summary aria-label={`More actions for ${row.title}`}>More</summary><label>Status<select class="dw-input" value={row.status} disabled={!connected || busy[row.id]} on:change={event => change(row, event.target.value)}>{#each MAY_DO_STATUSES as status}<option value={status}>{status}</option>{/each}</select></label></details></div>
              <details class="source"><summary>Source quote</summary><blockquote>{row.sourceQuote}</blockquote><div class="actions"><button class="dw-text-btn" on:click={() => copyQuote(row)}>Copy source quote</button>{#if hasTime(row)}<button class="dw-text-btn" on:click={event => playSource(event, row)}>Play source</button>{:else}<span class="dw-muted">No audio timing for this quote.</span>{/if}</div></details>
              {#if rowErrors[row.id]}<p role="alert" class="dw-error">{rowErrors[row.id]}</p>{/if}
            </article>
          {/each}
        </details>
      {:else}
        <section class="group" aria-label={group.status}><h4>{group.status === 'selected' ? 'Selected' : 'Suggested'} · {group.rows.length}</h4>
          {#each group.rows as row (row.id)}{@const primary = MAY_DO_PRIMARY[row.status]}
            <article aria-label={row.title}><strong>{row.title}</strong>
              <div class="actions"><button class="dw-btn-secondary" data-action-id={row.id} disabled={!connected || busy[row.id]} on:click={() => change(row, primary.status)}>{busy[row.id] ? 'Saving…' : primary.label}</button><details class="more"><summary aria-label={`More actions for ${row.title}`}>More</summary><label>Status<select class="dw-input" value={row.status} disabled={!connected || busy[row.id]} on:change={event => change(row, event.target.value)}>{#each MAY_DO_STATUSES as status}<option value={status}>{status}</option>{/each}</select></label></details></div>
              <details class="source"><summary>Source quote</summary><blockquote>{row.sourceQuote}</blockquote><div class="actions"><button class="dw-text-btn" on:click={() => copyQuote(row)}>Copy source quote</button>{#if hasTime(row)}<button class="dw-text-btn" on:click={event => playSource(event, row)}>Play source</button>{:else}<span class="dw-muted">No audio timing for this quote.</span>{/if}</div></details>
              {#if rowErrors[row.id]}<p role="alert" class="dw-error">{rowErrors[row.id]}</p>{/if}
            </article>
          {/each}
        </section>
      {/if}
    {/if}
  {/each}
</section>
<style>
  .review {padding:12px 0;overflow-wrap:anywhere;} header,.actions {display:flex;align-items:center;gap:8px;flex-wrap:wrap;} header {justify-content:space-between;} h3,h4 {font-size:14px;margin:8px 0;} article {border-bottom:1px solid var(--dw-border);padding:10px 0;} .actions {margin-top:6px;} .group {margin-top:12px;} summary,button,select {min-height:44px;} summary {cursor:pointer;padding:10px 0;} .more summary {padding:10px;} .more label {display:flex;align-items:center;gap:8px;} blockquote {margin:0;padding:8px 12px;border-left:2px solid var(--dw-border);user-select:text;} .source {color:var(--dw-muted);} .undo {display:flex;align-items:center;gap:8px;} button:focus-visible,summary:focus-visible,select:focus-visible {outline:2px solid var(--dw-accent);outline-offset:2px;}
</style>
