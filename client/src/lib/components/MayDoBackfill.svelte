<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  export let connected = false, showScope = true, job = null;
  const dispatch = createEventDispatcher();
  let scopeKind = 'all', year = String(new Date().getFullYear()), refresh = false, busy = false, error = '', timer;
  async function load() {
    try { const res = await fetch('/tools/may-dos/backfill'); if (!res.ok) throw new Error('Backfill status is unavailable.'); job = await res.json(); dispatch('change', job); }
    catch(e) { error = e.message; }
  }
  onMount(() => { void load(); timer = setInterval(() => { if (connected) void load(); }, 5000); });
  onDestroy(() => clearInterval(timer));
  async function command(action) {
    if (busy || !connected) return;
    busy = true; error = '';
    try {
      const res = await fetch('/tools/may-dos/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: job?.id, year: scopeKind === 'year' ? year.trim() : '', refresh }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Could not acknowledge the request. Refresh status before trying again.');
      job = data; dispatch('change', job);
    } catch(e) { error = e.message; }
    finally { busy = false; }
  }
</script>
<section class="backfill" aria-label="MayDo backfill">
  {#if showScope}<h3>Extract from older entries</h3><p class="dw-muted">Find possible actions in saved transcripts. Nothing is selected automatically. You can close this panel while extraction continues.</p>
    <form on:submit|preventDefault={() => command('start')}>
      <label>Scope<select class="dw-input" bind:value={scopeKind} disabled={job?.running || busy}><option value="all">All active entries</option><option value="year">One year</option></select></label>
      {#if scopeKind === 'year'}<label>Year<input class="dw-input" bind:value={year} inputmode="numeric" pattern={'[0-9]{4}'} maxlength="4" required disabled={job?.running || busy} /></label>{/if}
      <p>Model: {job?.model || 'Not configured'} · {scopeKind === 'year' ? `Active entries in ${year || '…'}` : 'All active entries'}</p>
      <details><summary>Advanced extraction options</summary><label class="check"><input type="checkbox" bind:checked={refresh} disabled={job?.running || busy} />Re-extract already current entries</label><p class="dw-muted">Unchanged entries are skipped by default. Refresh keeps action IDs and your selected, completed, and dismissed decisions.</p></details>
      <button class="dw-btn-secondary" disabled={!connected || busy || !job?.available || job?.running || job?.remaining > 0 || Boolean(job?.persistenceError)}>Start backfill</button>
      {#if !job?.running && job?.remaining > 0}<p class="dw-muted">Resume the saved scope below before starting another backfill. {job.remaining} entries remain.</p>{/if}
    </form>
  {/if}
  {#if !connected}<p role="status">Reconnect before starting or changing backfill.</p>{/if}
  {#if job && !job.available}<p class="dw-muted">{job.disabledReason}</p><details><summary>Cleanup setup</summary><p>Set <code>ollanet.machine</code> and <code>ollanet.cleanModel</code> in your DictaWhisper configuration, then restart the server. Check System status in Activity for connection problems.</p></details>{/if}
  {#if error}<p role="alert" class="dw-error">{error} <button class="dw-text-btn" on:click={() => { error = ''; void load(); }}>Refresh status</button></p>{/if}
  {#if job?.persistenceError}<p role="alert" class="dw-error">{job.persistenceError}</p>{/if}
  {#if job?.id}
    <h4>MayDo backfill · {job.state === 'interrupted' ? 'Interrupted' : job.state === 'stopping' ? 'Stopping after current entry' : job.state === 'completed' ? 'Completed' : job.state === 'stopped' ? 'Stopped' : 'Running'}</h4>
    <p class="dw-muted">Saved scope: {job.scope?.year ? `Active entries in ${job.scope.year}` : 'All active entries'}{job.scope?.refresh ? ' · Refresh current entries' : ' · Skip unchanged entries'}</p>
    <p role="status">Processed {job.processed} of {job.total} · {job.updated} extracted · {job.failed} failed</p>
    <p class="dw-muted">{job.skipReasons?.current || 0} already current · {job.skipReasons?.noTranscript || 0} no transcript · {job.skipReasons?.unreadable || 0} unreadable</p>
    {#if job.current}<p class="current">Current: {job.current.split(/[\\/]/).pop()}</p>{/if}
    {#if job.state === 'interrupted'}<p>Extraction stopped when the server restarted. Resume continues the saved scope; nothing starts automatically.</p>{/if}
    <div class="actions">
      {#if job.running}<button class="dw-btn-secondary" disabled={!connected || busy || job.stopping} on:click={() => command('stop')}>Stop after current entry</button>
      {:else}
        {#if job.remaining > 0}<button class="dw-btn-secondary" disabled={!connected || busy || !job.available || Boolean(job.persistenceError)} on:click={() => command('resume')}>Resume backfill</button>{/if}
        {#if job.failed > 0}<button class="dw-btn-secondary" disabled={!connected || busy || !job.available || Boolean(job.persistenceError)} on:click={() => command('retry_failed')}>Retry failed entries ({job.failed})</button>{/if}
      {/if}
    </div>
    {#if job.errors?.length}<details><summary>Failed entries · {job.failed}</summary><ul>{#each job.errors as failure}<li><span class="current">{failure.file}</span><p class="dw-error">{failure.error}</p></li>{/each}</ul></details>{/if}
  {/if}
</section>
<style>
  .backfill {overflow-wrap:anywhere;} h3,h4 {font-size:15px;margin:12px 0;} p {margin:8px 0;} form,label {display:flex;gap:8px;flex-direction:column;} form {align-items:flex-start;} label {width:100%;} .check {flex-direction:row;align-items:center;} .check input {width:22px;height:22px;} .actions {display:flex;gap:8px;flex-wrap:wrap;} button,summary,select,input:not([type=checkbox]) {min-height:44px;} summary {padding:10px 0;cursor:pointer;} .current {overflow-wrap:anywhere;} button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible {outline:2px solid var(--dw-accent);outline-offset:2px;}
</style>
