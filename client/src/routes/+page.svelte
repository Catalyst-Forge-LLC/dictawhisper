<script>
  import io from 'socket.io-client';
  import { onMount } from 'svelte';
  import MayDoBackfillDialog from '../lib/components/MayDoBackfillDialog.svelte';
  let backfillOpen = false;
  import ActivityDrawer from '../lib/components/ActivityDrawer.svelte';
  import { mergeActivity, working, failure } from '../lib/activityState.js';
  import AppHeader from '../lib/components/AppHeader.svelte';
  import HelpDrawer from '../lib/components/HelpDrawer.svelte';
  import SettingsDrawer from '../lib/components/SettingsDrawer.svelte';
  let settingsSection='General';
  import Transcriptions from '../lib/components/Transcriptions.svelte';

  const socket = io({ path: '/socket.io' });
  let helpOpen = false;
  let toolsOpen = false;
  let noteFilter = 'all';
  let navigationOpen = false;
  let activityOpen=false, connected=false, haveConnected=false, entryIntent=null, activityReady=false;
  let activitySnapshot={items:[],epoch:'',revision:0}, connectionError='';
  let activityRequest=0;
  async function refreshActivity(){ const request=++activityRequest;try{const res=await fetch('/notes/activity');if(!res.ok)throw new Error('Activity is unavailable.');const data=await res.json();if(request!==activityRequest)return;activitySnapshot=data;activityReady=true;connectionError='';}catch(error){connectionError=error.message;} }
  function openActivityEntry(item){ if(!item)return;entryIntent={...item,intentId:Date.now()};activityOpen=false; }
  onMount(()=>{
    const connect=()=>{connected=true;haveConnected=true;void refreshActivity();};
    const disconnect=()=>{connected=false;};
    const change=event=>{const next=mergeActivity(activitySnapshot,event);if(next)activitySnapshot=next;else void refreshActivity();};
    const snapshot=data=>{if(!activityReady || data.epoch!==activitySnapshot.epoch || data.revision>=activitySnapshot.revision){activitySnapshot=data;activityReady=true;}void refreshActivity();};
    const jobChange = job => { activitySnapshot = { ...activitySnapshot, mayDoBackfill: job }; };
    socket.on('maydo-job-change', jobChange);
    socket.on('connect',connect);socket.on('disconnect',disconnect);socket.on('connect_error',disconnect);socket.on('activity-change',change);socket.on('activity-snapshot',snapshot);
    if(socket.connected)connect();else void refreshActivity();
    return()=>{socket.off('maydo-job-change', jobChange);socket.off('connect',connect);socket.off('disconnect',disconnect);socket.off('connect_error',disconnect);socket.off('activity-change',change);socket.off('activity-snapshot',snapshot);};
  });
</script>

<div class="dw-app-shell">
  <AppHeader {navigationOpen} {connected} workingCount={activitySnapshot.items.filter(working).length} failureCount={activitySnapshot.items.filter(failure).length} on:activity={() => activityOpen=true} on:openentry={event=>openActivityEntry(event.detail)} on:accepted={refreshActivity} on:navigation={() => navigationOpen = !navigationOpen}
    on:help={() => {
      helpOpen = !helpOpen;
      if (helpOpen) toolsOpen = false;
    }}
    on:tools={() => {
      toolsOpen = !toolsOpen;
      if (toolsOpen) helpOpen = false;
    }}
  />
  {#if !connected}<p class="connection-notice" role="status">{haveConnected?'Connection lost · Reconnecting.':'Connecting.'} Saved transcripts stay available; writes wait for connection. <button class="dw-text-btn" on:click={()=>socket.connect()}>Reconnect</button></p>{/if}
  <main class="dw-main">
    <Transcriptions {socket} {connected} {entryIntent} {activityReady} activityItems={activitySnapshot.items} mayDoJob={activitySnapshot.mayDoBackfill} on:backfill={() => backfillOpen = true} on:configurecleanup={() => {settingsSection='Cleanup and MayDos';toolsOpen=true;}} on:opentrash={() => {settingsSection='Data and maintenance';toolsOpen=true;}} on:help={() => helpOpen=true} on:maintenance={() => {settingsSection='Data and maintenance';toolsOpen=true;}} bind:noteFilter bind:navigationOpen />
  </main>
  <ActivityDrawer bind:open={activityOpen} snapshot={activitySnapshot} loadError={connectionError} {connected} on:refresh={refreshActivity} on:openentry={event=>openActivityEntry(event.detail)} />
  <HelpDrawer bind:open={helpOpen} on:settings={()=>{settingsSection='General';toolsOpen=true;}} />
  <SettingsDrawer bind:open={toolsOpen} bind:section={settingsSection} bind:noteFilter {connected} on:help={()=>helpOpen=true} on:activity={()=>activityOpen=true} on:job={event=>activitySnapshot={...activitySnapshot,mayDoBackfill:event.detail}} />
  <MayDoBackfillDialog bind:open={backfillOpen} {connected} on:change={event => activitySnapshot = { ...activitySnapshot, mayDoBackfill: event.detail }} />
</div>

<style>.connection-notice{padding:4px 12px;font-size:12px;background:#392c14;flex-shrink:0;}.connection-notice button{min-height:44px;}</style>
