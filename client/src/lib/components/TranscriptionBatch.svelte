<script>
  import { onMount, onDestroy } from 'svelte';
  import AudioImprovementDialog from './AudioImprovementDialog.svelte';
  export let connected = false, compact = false;
  let job = null, error = '', busy = false, alive = true, timer, request = 0;
  let year = '', selection = 'outdated', model = 'bark-pro', policy = 'review', cleanup = false;
  let offset = 0, filter = 'work', selected = null;
  $: scopeChanged = job?.state === 'preview' && (year !== job.scope.year || selection !== job.scope.selection || model !== job.scope.model);
  const states = {idle:'Choose recordings to revisit',preview:'Preview ready',running:'Retranscribing',stopping:'Stopping after this entry',stopped:'Stopped',interrupted:'Interrupted · ready to resume',completed:'Batch complete'};
  const outcomes = {pending:'Pending',current:'Kept current',unavailable:'Unavailable',review:'Review candidate',applied:'Replaced',failed:'Needs attention'};
  onMount(refresh);
  onDestroy(() => { alive = false; request++; clearTimeout(timer); });
  async function decode(response) { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not update the batch.'); return data; }
  function schedule() { clearTimeout(timer); if (alive && job?.running) timer = setTimeout(refresh, 2500); }
  async function refresh() {
    const sequence = ++request;
    try {
      const data = await decode(await fetch(`/tools/transcription/batch?offset=${offset}&filter=${filter}`,{cache:'no-store'}));
      if (!alive || sequence !== request) return;
      if (!job && data.scope) { year = data.scope.year; selection = data.scope.selection; model = ['idle','completed'].includes(data.state) ? data.defaultModel : data.scope.model; policy = data.policy; cleanup = data.cleanup ?? false; }
      job = data; offset = data.offset; error = ''; schedule();
    } catch (e) { if (alive && sequence === request) error = e.message; }
  }
  async function act(action, extra = {}) {
    if (busy) return;
    busy = true; error = ''; clearTimeout(timer); request++;
    try {
      await decode(await fetch('/tools/transcription/batch', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:job?.id,...extra})}));
      if (!alive) return;
      if (action === 'preview') { offset = 0; filter = 'work'; }
      await refresh();
    } catch (e) { if (alive) error = e.message + ' Refresh status before retrying if the connection was interrupted.'; }
    finally { if (alive) { busy = false; schedule(); } }
  }
  async function closeReview() { const candidateId = selected.candidateId; selected = null; await act('review_result', { candidateId }); }
</script>
{#if !compact || job?.id || error}
<section class="batch" aria-label="Retranscribe library">
  <h3>Retranscribe library</h3>
  <p class="muted">Revisit existing recordings with automatic audio preparation and a fresh transcript. Originals and previous versions stay saved.</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if job?.persistenceError}<p class="error" role="alert">{job.persistenceError}</p>{/if}
  {#if !job}<p role="status">Loading saved batch…</p>{:else}
    {#if !compact && (!job.remaining || ['idle','preview'].includes(job.state)) && !job.running}
      <details open={['idle','preview'].includes(job.state)}><summary>Choose recordings</summary>
        <fieldset disabled={busy || !connected}>
          <label>Which entries?<select class="dw-input" bind:value={selection}><option value="outdated">Older pipeline, model or changed source</option><option value="flagged">Entries with audio or transcript signals</option><option value="all">All entries · include already updated</option></select></label>
          <div class="scope-row"><label>Recording year<input class="dw-input" inputmode="numeric" pattern={'[0-9]{4}'} maxlength="4" placeholder="All years" bind:value={year}/></label><label>Model<select class="dw-input" bind:value={model}><option value="bark-pro">Bark Pro · English</option><option value="large-v3">Whisper large-v3</option><option value="turbo">Whisper turbo · faster</option></select></label></div>
          <button class="dw-btn-secondary" disabled={busy || !connected || year && !/^\d{4}$/.test(year)} on:click={() => act('preview',{scope:{year,selection,model}})}>{busy?'Checking…':'Preview eligible entries'}</button>
        </fieldset>
        <p class="muted">Preview reads sidecars and source metadata. It starts no model jobs. Changed files with the same size and timestamp require “All entries”.</p>
      </details>
    {/if}
    {#if job.id}
      <div class="progress"><strong role="status">{states[job.state]}</strong><p>{job.scope.year || 'All years'} · {job.scope.model==='bark-pro'?'Bark Pro':`Whisper ${job.scope.model}`} · {job.total} entries</p><div class="counts"><span>{job.remaining} pending</span><span>{job.applied} replaced</span><span>{job.review} to review</span><span>{job.failed} failed</span><span>{job.skipped} skipped / kept</span></div>{#if job.running}<progress aria-label="Batch progress" max={Math.max(1,job.total)} value={job.total-job.remaining}></progress><p>{job.current || 'Starting the next entry…'}</p>{/if}</div>
      {#if job.modelIssue}<p role="status">{job.modelIssue}</p>{/if}
      {#if job.state==='preview'}
        <fieldset disabled={busy || !connected}>
          <legend>When a transcript is ready</legend>
          <label class="choice"><input type="radio" bind:group={policy} value="review"/><span><strong>Review before replacing</strong><small>Prepare every candidate; keep current transcripts until you accept them.</small></span></label>
          <label class="choice"><input type="radio" bind:group={policy} value="replace_unflagged"/><span><strong>Replace entries without review signals</strong><small>Save previous versions. Hold flagged candidates for listening. No automatic check guarantees accuracy.</small></span></label>
          {#if policy==='replace_unflagged'}<label class="choice"><input type="checkbox" bind:checked={cleanup} disabled={!job.cleanupEnabled}/><span>Also generate readable text, tags and MayDos<small>{job.cleanupEnabled?'Queued separately in Activity. Uses your configured cleanup model host.':'Enable the cleanup model and queue to use this option.'}</small></span></label>{/if}
          <p class="muted">Prepared WAVs, source snapshots and previous versions need extra disk space. Replacement changes the original transcript and removes its old readable version from the current view. Undo is available until later transcript processing changes it; history remains saved.</p>
          {#if scopeChanged}<p>Selection changed. Preview eligible entries again before starting.</p>{/if}
          <button class="dw-btn-primary" disabled={scopeChanged || !connected || busy || !job.enabled || !job.remaining || Boolean(job.persistenceError || job.modelIssue)} on:click={() => act('start',{policy,cleanup:policy==='replace_unflagged' && cleanup})}>Start {job.remaining} {policy==='review'?'candidates':'retranscriptions'}</button>
        </fieldset>
      {:else if job.running}<button class="dw-btn-secondary" disabled={busy || !connected || job.state==='stopping'} on:click={() => act('stop')}>Stop after this entry</button><p class="muted">You can close this panel. Processing continues while the server runs; after a restart, Resume continues saved progress.</p>
      {:else}<div class="actions">{#if job.remaining}<button class="dw-btn-primary" disabled={busy || !connected || !job.enabled || Boolean(job.persistenceError || job.modelIssue)} on:click={() => act('resume')}>Resume remaining work</button>{/if}{#if job.failed}<button class="dw-btn-secondary" disabled={busy || !connected || !job.enabled || Boolean(job.modelIssue)} on:click={() => act('retry_failed')}>Retry failed only</button>{/if}</div>{/if}
      {#if !job.enabled}<p>Transcription is disabled in Settings. Saved candidates and history remain available.</p>{/if}
      {#if job.cleanup && job.applied}<p class="muted">Readable processing can continue after this batch finishes. Check Activity for cleanup progress or failures.</p>{/if}
      <div class="results-head"><label>Show results<select class="dw-input" bind:value={filter} on:change={() => {offset=0;void refresh();}}><option value="work">Work in this batch</option><option value="all">All entries</option><option value="review">To review</option><option value="failed">Failed</option><option value="applied">Replaced</option><option value="unavailable">Unavailable</option></select></label><button class="dw-text-btn" disabled={busy} on:click={refresh}>Refresh status</button></div>
      {#if !job.rows.length}<p class="muted">No entries in this view.</p>{/if}
      <ul>{#each job.rows as row (row.file)}<li><div><strong>{row.title}</strong><small>{outcomes[row.outcome]}{row.note ? ' · '+row.note : ''}</small></div>{#if row.candidateId && ['review','applied'].includes(row.outcome)}<button class="dw-btn-secondary" disabled={busy || !connected} on:click={() => selected=row}>{row.outcome==='applied'?'History / Undo':'Review'}</button>{/if}</li>{/each}</ul>
      <div class="pages"><button class="dw-btn-secondary" disabled={!offset || busy} on:click={() => {offset=Math.max(0,offset-50);void refresh();}}>Previous</button><span>{job.filteredTotal ? `${offset+1}–${Math.min(offset+50,job.filteredTotal)} of ${job.filteredTotal}` : '0 results'}</span><button class="dw-btn-secondary" disabled={offset+50>=job.filteredTotal || busy} on:click={() => {offset+=50;void refresh();}}>Next</button></div>
    {/if}
  {/if}
  {#if error}<button class="dw-btn-secondary" on:click={refresh}>Refresh batch status</button>{/if}
</section>
{/if}
{#if selected}<AudioImprovementDialog file={selected.file} initialAttemptId={selected.candidateId} on:close={closeReview}/>{/if}
<style>
  .batch{border-top:1px solid var(--dw-border);padding-top:16px;margin-top:20px;} h3{font-size:18px;margin:0;} p{font-size:14px;line-height:1.5;} .muted,small{color:var(--dw-text-muted);} .error{color:#fca5a5;} fieldset{border:0;padding:0;min-width:0;margin:14px 0;} label{display:flex;flex-direction:column;gap:6px;margin:12px 0;font-size:14px;} .scope-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;} input,select{box-sizing:border-box;width:100%;min-width:0;} .choice{display:flex;flex-direction:row;align-items:start;gap:10px;} .choice input{width:18px;height:18px;min-height:18px;margin-top:3px;accent-color:var(--dw-accent);flex-shrink:0;} small{display:block;line-height:1.5;margin-top:4px;} legend,summary{font-weight:600;} summary{min-height:44px;align-content:center;cursor:pointer;} .progress{background:#ffffff05;padding:14px;border:1px solid var(--dw-border);border-radius:8px;margin:16px 0;} .progress p{margin:8px 0;} .counts{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--dw-text-muted);} progress{width:100%;height:8px;margin-top:14px;accent-color:var(--dw-accent);} .actions,.pages,.results-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;} .results-head{justify-content:space-between;} .results-head label{flex:1;min-width:130px;} button{min-height:44px;} .pages{justify-content:space-between;font-size:12px;} ul{list-style:none;margin:0;padding:0;} li{display:flex;align-items:start;gap:10px;border-top:1px solid var(--dw-border);padding:12px 0;font-size:13px;} li div{flex:1;min-width:0;overflow-wrap:anywhere;} li strong{font-weight:500;} li button{flex-shrink:0;} :is(summary,button,input,select):focus-visible{outline:2px solid var(--dw-focus);outline-offset:2px;} @media(max-width:420px){.scope-row{grid-template-columns:1fr;}li{flex-wrap:wrap;}}
  ul{max-height:360px;overflow:auto;scrollbar-gutter:stable;}
</style>
