<script>
  import MayDoBackfill from './MayDoBackfill.svelte';
  import { createEventDispatcher, tick, onDestroy } from 'svelte';
  import { stageCopy, working, failure, retryLabel } from '../activityState.js';
  export let open = false, snapshot = { items: [] }, connected = false, loadError='';
  const dispatch = createEventDispatcher();
  let dialog, priorFocus, health = null, error = '', busy = {}, timer, clock = Date.now();
  $: running = snapshot.items.filter(working);
  $: failures = snapshot.items.filter(failure);
  $: completed = snapshot.items.filter(item => !working(item) && !failure(item));
  $: if (dialog && open && !dialog.open) { priorFocus = document.activeElement; dialog.showModal(); tick().then(() => dialog.querySelector('button')?.focus()); dispatch('refresh'); timer = setInterval(() => { clock = Date.now(); dispatch('refresh'); }, 5000); }
  $: if (dialog && !open && dialog.open) { clearInterval(timer); dialog.close(); priorFocus?.focus({preventScroll:true}); }
  onDestroy(() => clearInterval(timer));
  async function command(item, action) { if (!connected) return; busy = {...busy,[item.id]:true}; error = ''; try { const res = await fetch(`/notes/activity/${action}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})}); const data=await res.json(); if(!res.ok)throw new Error(data.error); dispatch('refresh'); } catch(e){error=e.message;} finally{busy={...busy,[item.id]:false};} }
  async function checks(fresh=false) { error=''; try { const res=await fetch('/health'+(fresh?'?fresh=1':'')); health=await res.json(); }catch(e){error='System status is unavailable. Reconnect and try again.';} }
</script>
<dialog bind:this={dialog} aria-labelledby="activity-title" on:cancel|preventDefault={() => open=false}>
  {#if loadError}<p class="dw-error" role="alert">{loadError} Showing the last received status. <button class="dw-text-btn" on:click={()=>dispatch('refresh')}>Refresh activity</button></p>{/if}
  <header><h2 id="activity-title">Activity</h2><button class="dw-btn-secondary" on:click={() => open=false}>Close activity</button></header>
  {#if !connected}<p role="status">Connection lost · Reconnecting. Reading stays available. Writes wait for a connection.</p>{/if}
  {#if snapshot.persistenceError}<p class="dw-error" role="alert">{snapshot.persistenceError}</p>{/if}
  {#if error}<p class="dw-error" role="alert">{error}</p>{/if}
  <section><h3>In progress · {running.length}</h3>{#if !running.length}<p class="dw-muted">No work in progress.</p>{/if}
  {#each running as item (item.id)}<article><button class="entry-link" on:click={() => dispatch('openentry',item)}>{item.originalName || item.audioFile.split(/[\\/]/).pop()}</button><p>{stageCopy[item.stage]}</p>{#if item.eligibleAt}<p class="dw-muted">Eligible {new Date(item.eligibleAt).toLocaleTimeString()} · about {Math.max(0,Math.ceil((item.eligibleAt-clock)/1000))}s remaining. New writes reset this wait.</p>{/if}{#if item.reason}<p class="dw-muted">{item.reason}</p>{/if}{#if item.stage==='waiting_for_file'}<button class="dw-btn-secondary" disabled={!connected || busy[item.id]} on:click={() => command(item,'process-now')}>Process now if stable</button>{/if}</article>{/each}</section>
  {#if open && snapshot.mayDoBackfill?.id}<MayDoBackfill {connected} showScope={false} job={snapshot.mayDoBackfill} on:change={() => dispatch('refresh')} />{/if}
  <section><h3>Needs attention · {failures.length}</h3>{#if !failures.length}<p class="dw-muted">No processing failures.</p>{/if}{#each failures as item (item.id)}<article><button class="entry-link" on:click={() => dispatch('openentry',item)}>{item.originalName || item.audioFile.split(/[\\/]/).pop()}</button><p>{stageCopy[item.stage]}</p><p class="dw-error">{item.error || item.reason}</p><button class="dw-btn-secondary" disabled={!connected || busy[item.id]} on:click={() => command(item,'retry')}>{retryLabel(item)}</button>{#if item.hasTranscript}<button class="dw-text-btn" on:click={() => dispatch('openentry',item)}>Read transcript</button>{/if}</article>{/each}</section>
  <section><h3>Recent completed</h3>{#each completed.slice(0,5) as item (item.id)}<article><button class="entry-link" on:click={() => dispatch('openentry',item)}>{item.originalName || item.audioFile.split(/[\\/]/).pop()}</button><p>{stageCopy[item.stage]}</p>{#if item.reason}<p class="dw-muted">{item.reason}</p>{/if}</article>{/each}{#if completed.length>5}<details><summary>{completed.length-5} earlier completed entries</summary>{#each completed.slice(5) as item (item.id)}<article><button class="entry-link" on:click={() => dispatch('openentry',item)}>{item.originalName || item.audioFile.split(/[\\/]/).pop()}</button><p>{stageCopy[item.stage]}</p></article>{/each}</details>{/if}</section>
  <details on:toggle={event => {if(event.currentTarget.open&&!health)checks();}}><summary>System status and diagnostics</summary>{#if health}<p>Transcription: {health.whisperWorker || 'See checks'} · {typeof health.whisper==='string'?health.whisper:health.whisper?.model || ''} · {health.device || ''}</p><p>Cleanup: {health.ollanet?.reachable?'Available':health.ollanet?.machine?'Unavailable':'Not configured; original reading works'}</p>{#each health.checks || [] as check}<p class="dw-muted">{check.message}</p>{/each}{/if}<button class="dw-btn-secondary" on:click={() => checks(true)}>Run checks</button></details>
</dialog>
<style>
  dialog { position:fixed; inset:0 0 0 auto; margin:0; width:min(480px,100vw); max-width:100vw; height:100dvh; max-height:100dvh; padding:16px; color:var(--dw-text); background:#18181b; border:0; border-left:1px solid var(--dw-border); overflow:auto; } dialog::backdrop {background:#0008;}
  header {display:flex;align-items:center;justify-content:space-between;gap:8px;} h2 {font-size:18px;} h3 {font-size:14px;margin:16px 0 8px;} article {padding:10px 0;border-bottom:1px solid var(--dw-border);overflow-wrap:anywhere;} p {margin:6px 0;} .entry-link {background:none;border:0;color:var(--dw-accent-bright);text-align:left;font:inherit;overflow-wrap:anywhere;cursor:pointer;} button,summary {min-height:44px;} button:focus-visible,summary:focus-visible {outline:2px solid var(--dw-accent);outline-offset:2px;} details {margin-top:16px;}
</style>
