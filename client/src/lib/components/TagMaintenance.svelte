<script>
  export let connected=false;
  let useModel=false,plan=null,selected={},busy=false,error='',result='',confirm=false;
  async function post(action,body){const response=await fetch('/tags/consolidate/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
  async function preview(){busy=true;error='';plan=null;confirm=false;try{plan=await post('preview',{useModel});selected=Object.fromEntries(plan.groups.map((group,i)=>[i,group.reason!=='synonym']));}catch(e){error=e.message;}finally{busy=false;}}
  async function apply(){busy=true;error='';try{const groups=plan.groups.filter((_,i)=>selected[i]);const data=await post('apply',{groups});result=`Merged tags on ${data.filesChanged} entries; ${data.failed||0} failed.`;error=(data.errors||[]).map(row=>row.file+': '+row.error).join('\n');plan=null;confirm=false;}catch(e){error=e.message;}finally{busy=false;}}
</script>
<h3>Consolidate tags</h3><p>Preview spelling duplicates or optional model proposals. Applying changes tags on affected entries; this batch has no Undo.</p>
<label><input type="checkbox" bind:checked={useModel} disabled={busy}/> Ask cleanup model for synonyms · sends tags to configured host</label><button class="dw-btn-secondary" disabled={!connected||busy} on:click={preview}>{busy?'Working…':'Preview tag merges'}</button>
{#if error}<p class="dw-error" role="alert">{error}</p>{/if}{#if result}<p role="status">{result}</p>{/if}
{#if plan}<p>{plan.unique} unique tags · {plan.groups.length} proposed merges</p>{#if plan.modelError}<p>{plan.modelError}</p>{/if}
{#each plan.groups as group,i}<label><input type="checkbox" bind:checked={selected[i]} disabled={busy}/><span>Keep <strong>{group.keep}</strong> ← {group.drop.join(', ')}<br/>{group.affectedEntries??'?'} affected entries · {group.reason}</span></label>{/each}
<label><input type="checkbox" bind:checked={confirm} disabled={busy}/> Apply reviewed groups to entry sidecars; no batch Undo</label><button class="dw-btn-primary" disabled={!connected||busy||!confirm||!plan.groups.some((_,i)=>selected[i])} on:click={apply}>Apply reviewed merges</button><button class="dw-text-btn" disabled={busy} on:click={()=>plan=null}>Cancel review</button>{/if}
<style>label{display:flex;align-items:flex-start;gap:10px;margin:12px 0;line-height:1.5;}button,input{min-height:44px;}button{margin:8px 8px 8px 0;}input[type=checkbox]{flex-shrink:0;}</style>
