<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { stageCopy } from '../activityState.js';
  export let item, savedTime=0;
  const dispatch=createEventDispatcher(); let player, restored=false, error='';
  function metadata(){ if(restored)return; restored=true; player.currentTime=Math.min(savedTime,Number.isFinite(player.duration)?player.duration:savedTime);player.dataset.positionRestored='true'; }
  function play(){document.querySelectorAll('audio').forEach(audio=>{if(audio!==player)audio.pause();});}
  onDestroy(()=>player?.pause());
</script>
<div data-entry-key={item.jsonFile}><p role="status">{stageCopy[item.stage]}</p>{#if item.error}<p class="dw-error">{item.error}</p>{/if}{#if item.reason}<p class="dw-muted">{item.reason}</p>{/if}<audio bind:this={player} controls on:play={play} preload="metadata" src={'/audio?file='+encodeURIComponent(item.audioFile)} on:loadedmetadata={metadata} on:timeupdate={event=>dispatch('time',event)} on:error={()=>error='Saved audio could not be loaded. Reconnect and check Activity.'}></audio>{#if error}<p class="dw-error" role="alert">{error}</p>{/if}<p>Transcript not ready yet. You can keep reading other entries while this recording processes.</p></div>
<style>audio{width:100%;margin:12px 0;}p{margin:8px 0;}</style>
