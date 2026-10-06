<script>
 import {onMount,createEventDispatcher} from 'svelte';export let connected=false;
 const dispatch=createEventDispatcher();let items=[],selected={},busy=false,error='',result='';
 async function refresh(){try{const response=await fetch('/notes/activity');if(!response.ok)throw new Error('Activity unavailable');const data=await response.json();items=data.items.filter(item=>item.stage==='failed_cleanup');}catch(e){error=e.message;}}
 async function retry(){busy=true;error='';let accepted=0,failed=0;for(const item of items.filter(item=>selected[item.id])){try{const response=await fetch('/notes/activity/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});const data=await response.json();if(!response.ok)throw new Error(data.error);accepted++;}catch(e){failed++;error+=(error?'\n':'')+item.originalName+': '+e.message;}}result=`${accepted} retries accepted · ${failed} rejected`;busy=false;await refresh();}
 onMount(refresh);
</script>
<h3>Retry failed cleanup</h3><p>Retry selected failures using the configured cleanup host. Transcript text and tags are sent there. Original speech and human decisions remain available; accepted work appears in Activity.</p>
<button class="dw-btn-secondary" disabled={busy} on:click={refresh}>Refresh cleanup failures</button>{#if !items.length}<p>No failed cleanup entries in Activity.</p>{/if}
{#each items as item}<label><input type="checkbox" bind:checked={selected[item.id]} disabled={busy}/><span>{item.originalName||item.jsonFile}<br/>{item.error}</span></label>{/each}
<button class="dw-btn-primary" disabled={!connected||busy||!items.some(item=>selected[item.id])} on:click={retry}>{busy?'Requesting retries…':'Retry selected cleanup failures'}</button><button class="dw-text-btn" on:click={()=>dispatch('activity')}>Open Activity</button>
{#if error}<p class="dw-error" role="alert">{error}</p>{/if}{#if result}<p role="status">{result}</p>{/if}
<style>label{display:flex;gap:10px;align-items:flex-start;margin:12px 0;overflow-wrap:anywhere;}button,input{min-height:44px;}button{margin:6px 8px 6px 0;}p{line-height:1.5;}</style>
