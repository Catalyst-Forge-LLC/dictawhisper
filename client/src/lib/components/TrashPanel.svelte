<script>
  import {fileSizeLabel} from '../entryPresentation.js';
  import {onMount} from 'svelte';
  export let connected=false;
  let items=[],error='',busy='',preview=null,confirmation='',purging='';
  async function refresh(){try{const response=await fetch('/notes/trash');const data=await response.json();if(!response.ok)throw new Error(data.error);items=data.items||[];}catch(e){error=e.message;}}
  async function act(action,item){busy=item.id;error='';try{const response=await fetch('/notes/trash/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,confirmation})});const data=await response.json();if(!response.ok)throw new Error(data.error+(data.details?' '+JSON.stringify(data.details):''));if(action==='preview')preview={...data,title:item.title};else{preview=null;purging='';confirmation='';await refresh();}}catch(e){error=e.message;}finally{busy='';}}
  onMount(refresh);
</script>
<h3>Trash</h3><p>Removed entries retain their transcript and all audio files here until you permanently delete them.</p>
<button class="dw-btn-secondary" on:click={refresh}>Refresh Trash</button>
{#if error}<p class="dw-error" role="alert">{error}</p>{/if}
{#if !items.length}<p>Trash is empty.</p>{/if}
{#each items as item (item.id)}
  <section><strong>{item.title}</strong><p>{item.deletedAt||''} · {item.fileCount||'?'} files · {fileSizeLabel(item.bytes)}</p><code>{item.originalJsonFile||''}</code>
    {#if item.state==='recovery_needed'}<p role="status">An interrupted operation needs review. All retained copies are kept.</p><p>{item.error||''}</p><button class="dw-btn-secondary" disabled={!connected||Boolean(busy)} on:click={()=>act('recover',item)}>Check retained files</button>
    {:else}<button class="dw-btn-primary" disabled={!connected||Boolean(busy)} on:click={()=>act('preview',item)}>Restore…</button><button class="dw-text-btn" disabled={!connected||Boolean(busy)} on:click={()=>{purging=item.id;confirmation='';preview=null;}}>Delete permanently…</button>{/if}
    {#if preview?.id===item.id}<p>{preview.conflicts.length?'Destination exists. Restore keeps both entries with a new filename.':'Restore destination:'}</p><code>{preview.jsonFile}</code><button class="dw-btn-primary" disabled={!connected||Boolean(busy)} on:click={()=>act('restore',item)}>Confirm restore{preview.conflicts.length?' · Keep both':''}</button><button class="dw-text-btn" on:click={()=>preview=null}>Cancel restore</button>{/if}
    {#if purging===item.id}<p>Delete “{item.title}” permanently, including its transcript and {item.fileCount} saved files. Undo will be unavailable.</p><label>Type DELETE AUDIO AND TRANSCRIPT <input bind:value={confirmation}/></label><button class="dw-btn-secondary" disabled={!connected||Boolean(busy)||confirmation!=='DELETE AUDIO AND TRANSCRIPT'} on:click={()=>act('purge',item)}>Permanently delete audio and transcript</button><button class="dw-text-btn" on:click={()=>purging=''}>Cancel deletion</button>{/if}
  </section>
{/each}
<style>section{padding:16px 0;border-top:1px solid var(--dw-border);}p{line-height:1.5;}code{display:block;overflow-wrap:anywhere;font-size:12px;}button,input{min-height:44px;}button{margin:8px 6px 0 0;}label{display:block;margin:12px 0;}input{display:block;width:100%;box-sizing:border-box;}</style>
