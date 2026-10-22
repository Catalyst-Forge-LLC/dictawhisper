<script>
  import AppIcon from './AppIcon.svelte';
  import MayDoBackfill from './MayDoBackfill.svelte';
  import TranscriptionBatch from './TranscriptionBatch.svelte';
  import { createEventDispatcher, tick, onDestroy } from 'svelte';
  import { stageCopy, working, failure, retryLabel } from '../activityState.js';
  export let open = false, snapshot = { items: [] }, connected = false, loadError='';
  const dispatch = createEventDispatcher();
  const views = [
    {id:'working',label:'In progress',icon:'activity',tone:'info',empty:'No work in progress.'},
    {id:'attention',label:'Needs attention',icon:'attention',tone:'danger',empty:'No processing failures.'},
    {id:'completed',label:'Completed',icon:'check',tone:'success',empty:'No completed entries in recent activity.'},
  ];
  let dialog, priorFocus, health = null, error = '', busy = {}, timer, clock = Date.now(), checking = false;
  let view = 'working', limit = 15, batchesOpen = false, retryFocus = null;
  $: groups = {
    working: snapshot.items.filter(working),
    attention: snapshot.items.filter(failure),
    completed: snapshot.items.filter(item => !working(item) && !failure(item)),
  };
  $: rows = groups[view];
  $: currentView = views.find(item => item.id === view);
  $: if (retryFocus && !rows.some(item => item.id === retryFocus.id)) {
    const previous = retryFocus; retryFocus = null;
    tick().then(() => {
      if (open && !previous.element?.isConnected && document.activeElement === document.body) {
        dialog.querySelector('.view-switcher [aria-pressed="true"]')?.focus({preventScroll:true});
      }
    });
  }
  $: if (dialog && open && !dialog.open) {
    view = groups.attention.length ? 'attention' : groups.working.length ? 'working' : 'completed';
    limit = 15; batchesOpen = Boolean(snapshot.mayDoBackfill?.running || snapshot.transcriptionBatch?.running);
    priorFocus = document.activeElement; dialog.showModal();
    tick().then(() => dialog.querySelector('header button')?.focus());
    dispatch('refresh'); timer = setInterval(() => { clock = Date.now(); dispatch('refresh'); }, 5000);
  }
  $: if (dialog && !open && dialog.open) { clearInterval(timer); retryFocus=null; dialog.close(); priorFocus?.focus({preventScroll:true}); }
  onDestroy(() => clearInterval(timer));
  async function command(item, action, element) {
    if (!connected || busy[item.id]) return;
    busy = {...busy,[item.id]:true}; error = '';
    try {
      const res = await fetch('/notes/activity/' + action, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});
      const data=await res.json(); if(!res.ok)throw new Error(data.error); retryFocus={id:item.id,element}; dispatch('refresh');
    } catch(e){error=e.message;} finally{busy={...busy,[item.id]:false};}
  }
  async function checks(fresh=false) {
    if(checking)return; checking=true; error='';
    try { const res=await fetch('/health'+(fresh?'?fresh=1':'')); if(!res.ok)throw new Error(); health=await res.json(); }
    catch{error='System status is unavailable. Reconnect and try again.';}finally{checking=false;}
  }
</script>
<dialog bind:this={dialog} aria-labelledby="activity-title" on:cancel|preventDefault={() => open=false}>
  <header>
    <div class="heading"><h2 id="activity-title" class="dw-with-icon"><AppIcon name="activity"/>Activity</h2><button class="dw-btn-secondary" on:click={() => open=false}><AppIcon name="close" size={16}/>Close activity</button></div>
    <div class="view-switcher" role="group" aria-label="Activity view">
      {#each views as choice}<button class:chosen={view===choice.id} data-tone={choice.tone} aria-pressed={view===choice.id} on:click={()=>{view=choice.id;limit=15;dialog.scrollTop=0;}}>
        <span class="view-count"><AppIcon name={choice.icon} size={16}/>{groups[choice.id].length}</span><span>{choice.label}</span>
      </button>{/each}
    </div>
  </header>
  {#if loadError}<p class="dw-error" role="alert">{loadError} Showing the last received status. <button class="dw-text-btn" on:click={()=>dispatch('refresh')}>Refresh activity</button></p>{/if}
  {#if !connected}<p class="dw-status dw-tone-info" role="status"><AppIcon name="link" size={16}/>Reconnecting. Reading stays available; changes wait for a connection.</p>{/if}
  {#if snapshot.persistenceError}<p class="dw-error" role="alert">{snapshot.persistenceError}</p>{/if}
  {#if error}<p class="dw-error" role="alert">{error}</p>{/if}
  <details class="dw-disclosure batches" bind:open={batchesOpen}><summary><AppIcon name="library" size={16}/>Library batches{#if snapshot.mayDoBackfill?.running || snapshot.transcriptionBatch?.running}<span class="dw-status dw-tone-info">Running</span>{/if}</summary>
    {#if open && batchesOpen}
      {#if snapshot.mayDoBackfill?.id}<MayDoBackfill {connected} showScope={false} job={snapshot.mayDoBackfill} on:change={() => dispatch('refresh')}/>{/if}
      <TranscriptionBatch {connected} compact/>
      {#if !snapshot.mayDoBackfill?.id && !snapshot.transcriptionBatch?.id}<p class="dw-muted">No saved library batches. Start MayDo extraction or retranscription in Settings → Data and maintenance.</p>{/if}
    {/if}
  </details>
  <section aria-label={currentView.label}>
    <h3>{currentView.label}</h3>
    {#if !rows.length}<p class="dw-empty"><AppIcon name={currentView.icon}/><span>{currentView.empty}</span></p>{/if}
    {#each rows.slice(0,limit) as item (item.id)}
      <article>
        <button class="entry-link" on:click={() => dispatch('openentry',item)}>{item.originalName || item.audioFile.split(/[\\/]/).pop()}<AppIcon name="chevron" size={16}/></button>
        <p class={'dw-status dw-tone-'+currentView.tone}><AppIcon name={currentView.icon} size={14}/>{stageCopy[item.stage] || item.stage}</p>
        {#if view==='working' && item.eligibleAt}<p class="dw-muted">Ready to check at {new Date(item.eligibleAt).toLocaleTimeString()} · about {Math.max(0,Math.ceil((item.eligibleAt-clock)/1000))}s remaining. New writes reset this wait.</p>{/if}
        {#if failure(item)}<p class="failure-reason">{item.error || item.reason}</p>
          <div class="actions"><button class="dw-btn-secondary" disabled={!connected || busy[item.id]} on:click={event => command(item,'retry',event.currentTarget)}><AppIcon name="refresh" size={16}/>{busy[item.id]?'Requesting…':retryLabel(item)}</button>{#if item.hasTranscript}<button class="dw-text-btn dw-with-icon" on:click={() => dispatch('openentry',item)}><AppIcon name="transcript" size={16}/>Read transcript</button>{/if}</div>
        {:else if item.reason}<p class="dw-muted">{item.reason}</p>{/if}
        {#if item.stage==='waiting_for_file'}<button class="dw-btn-secondary" disabled={!connected || busy[item.id]} on:click={event => command(item,'process-now',event.currentTarget)}><AppIcon name="play" size={16}/>Process now if stable</button>{/if}
      </article>
    {/each}
    {#if rows.length>limit}<button class="dw-btn-secondary more-results" on:click={()=>limit+=15}>Show {Math.min(15,rows.length-limit)} more · {rows.length-limit} remaining</button>{/if}
  </section>
  <details class="dw-disclosure diagnostics" on:toggle={event => {if(event.currentTarget.open&&!health)checks();}}><summary><AppIcon name="settings" size={16}/>System status and diagnostics</summary>
    {#if health}<p>Transcription: {health.transcription?.model === 'bark-pro' ? 'Bark Pro' : `Whisper ${health.transcription?.model || (typeof health.whisper==='string'?health.whisper:health.whisper?.model) || ''}`} · {health.transcription?.device || health.device || 'See checks'}</p><p>Cleanup: {health.ollanet?.reachable?'Available':health.ollanet?.machine?'Unavailable':'Not configured; original reading works'}</p>{#each health.checks || [] as check}<p class="dw-muted">{check.message}</p>{/each}{/if}
    <button class="dw-btn-secondary" disabled={checking} on:click={() => checks(true)}><AppIcon name="refresh" size={16}/>{checking?'Checking…':'Run checks'}</button>
  </details>
</dialog>
<style>
  dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(540px,100vw);max-width:100vw;height:100dvh;max-height:100dvh;padding:0 20px 20px;color:var(--dw-text);background:var(--dw-surface);border:0;border-left:1px solid var(--dw-border);overflow:auto;}dialog::backdrop{background:#0009;}
  header{position:sticky;top:0;background:var(--dw-surface);padding:16px 0 12px;z-index:2;border-bottom:1px solid var(--dw-border);}
  .heading{display:flex;align-items:center;justify-content:space-between;gap:8px;}h2{font-size:20px;}h3{font-size:14px;margin:16px 0 8px;}
  .view-switcher{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:16px;}.view-switcher button{font:inherit;font-size:12px;color:var(--dw-text-muted);background:transparent;border:1px solid var(--dw-border);border-radius:8px;padding:10px 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;}
  .view-count{display:flex;align-items:center;gap:6px;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;}
  .chosen[data-tone='info']{color:var(--dw-info);background:var(--dw-info-bg);border-color:var(--dw-info);}
  .chosen[data-tone='danger']{color:var(--dw-danger);background:var(--dw-danger-bg);border-color:var(--dw-danger);}
  .chosen[data-tone='success']{color:var(--dw-success);background:var(--dw-success-bg);border-color:var(--dw-success);}
  article{padding:14px 0;border-bottom:1px solid var(--dw-border);overflow-wrap:anywhere;}p{margin:8px 0;line-height:1.5;font-size:13px;}
  .entry-link{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;background:none;border:0;color:var(--dw-text);text-align:left;font:inherit;font-size:14px;font-weight:600;overflow-wrap:anywhere;cursor:pointer;}
  .entry-link:hover{color:var(--dw-accent-bright);}button,summary{min-height:44px;}.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}.failure-reason{color:var(--dw-text-muted);}
  .dw-empty{display:flex;align-items:center;gap:10px;text-align:left;}.batches,.diagnostics{border-bottom:1px solid var(--dw-border);padding:6px 0;}.diagnostics{margin-top:16px;}.more-results{margin-top:12px;}
  @media(max-width:400px){dialog{padding:0 16px 16px;}.view-switcher button{font-size:11px;}}
</style>
