<script>
  import {fileSizeLabel} from '../entryPresentation.js';
  import { tick, createEventDispatcher } from 'svelte';
  export let file='', connected=false, initialMode='date';
  const dispatch=createEventDispatcher();
  let dialog, priorFocus, date='', preview=null, error='', busy=false, confirmed=false, mode='date';
  async function post(action, body) { const response=await fetch('/notes/organization/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const data=await response.json(); if(!response.ok)throw new Error(data.error+(data.details?' '+JSON.stringify(data.details):''));return data; }
  async function refresh() {busy=true;error='';preview=null;confirmed=false;try{preview=await post('preview',{file,...(mode==='date'?{date}:mode==='unfile'?{unfile:true}:{})});}catch(e){error=e.message;}finally{busy=false;}}
  async function apply(action) {busy=true;error='';try{const result=await post('apply',{file,...(mode==='date'?{date}:mode==='unfile'?{unfile:true}:{}),action,fingerprint:preview.fingerprint,confirmed});dispatch('applied',result);file='';}catch(e){error=e.message;}finally{busy=false;}}
  $: if(dialog && file && !dialog.open){priorFocus=document.activeElement;date='';mode=initialMode;preview=null;error='';dialog.showModal();if(mode!=='date')void refresh();tick().then(()=>dialog.querySelector('input,button')?.focus());}
  $: if(dialog && !file && dialog.open){dialog.close();(priorFocus?.isConnected && priorFocus.getClientRects().length ? priorFocus : document.querySelector('[data-settings-trigger]')?.getClientRects().length ? document.querySelector('[data-settings-trigger]') : document.querySelector('[data-settings-trigger]'))?.focus({preventScroll:true});}
</script>
<dialog bind:this={dialog} aria-label="Organize entry" on:cancel|preventDefault={()=>{if(!busy)file='';}}>
  <header><h2>Organize entry</h2><button class="dw-btn-secondary" disabled={busy} on:click={()=>file=''}>Close</button></header>
  <p>Move the transcript and all its audio variants together. Your recording stays readable while you decide.</p>
  <label>Destination <select bind:value={mode} disabled={busy} on:change={()=>{preview=null;confirmed=false;if(mode!=='date')void refresh();}}><option value="date">Assign recording date</option><option value="file">File using filename date</option><option value="unfile">Unfiled</option></select></label>
  {#if mode==='date'}<label>Recording date <input type="date" bind:value={date} disabled={busy} on:input={()=>{preview=null;confirmed=false;}} /></label><button class="dw-btn-secondary" disabled={busy||!date||!connected} on:click={refresh}>Preview destination</button>{/if}
  {#if error}<p class="dw-error" role="alert">{error}</p><button class="dw-btn-secondary" disabled={busy||!connected} on:click={refresh}>Refresh preview</button>{/if}
  {#if preview}
    <div class="comparison"><section><h3>Incoming entry</h3><strong>{preview.incoming.title}</strong><p>{preview.incoming.date} · {preview.incoming.files.length} files · {fileSizeLabel(preview.incoming.files.reduce((sum,row)=>sum+row.bytes,0))}</p><p>{preview.incoming.preview}</p><code>{preview.file}</code><details><summary>Included files</summary>{#each preview.incoming.files as row}<code>{row.file.split(/[/\\]/).pop()} · {row.bytes} bytes</code>{/each}</details></section>
    {#if preview.existing}<section><h3>Existing entry</h3><strong>{preview.existing.title}</strong><p>{preview.existing.date} · {preview.existing.files.length} files · {fileSizeLabel(preview.existing.files.reduce((sum,row)=>sum+row.bytes,0))}</p><p>{preview.existing.preview}</p><code>{preview.target}</code><details><summary>Included files</summary>{#each preview.existing.files as row}<code>{row.file.split(/[/\\]/).pop()} · {row.bytes} bytes</code>{/each}</details></section>{/if}</div>
    <h3>{preview.conflict?'Keep both destination':'Destination'}</h3><code>{preview.keepBoth}</code>
    <button class="dw-btn-primary" disabled={busy||!connected} on:click={()=>apply('keep_both')}>{busy?'Moving…':preview.conflict?'Keep both':'Move entry'}</button>
    {#if preview.existing}
      <button class="dw-btn-secondary" disabled={busy||!connected} on:click={()=>apply('keep_existing')}>Keep existing · Trash incoming</button>
      <label><input type="checkbox" bind:checked={confirmed} disabled={busy}/> Replace existing; preserve its audio and transcript in Trash</label>
      <button class="dw-btn-secondary" disabled={busy||!connected||!confirmed} on:click={()=>apply('replace')}>Replace existing</button>
    {/if}
  {/if}
  <p role="status">{busy?'Working…':''}</p>
</dialog>
<style>.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:16px;}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;}dialog{background:#18181b;color:var(--dw-text);border:1px solid var(--dw-border);border-radius:14px;width:min(640px,calc(100vw - 24px));max-height:90dvh;padding:20px;overflow:auto;}dialog::backdrop{background:#0009;}header{position:sticky;top:-20px;background:#18181b;padding:8px 0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;}h2{font-size:20px;}label{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0;}select,input,button{min-height:44px;}button{margin:8px 4px 8px 0;}code{display:block;overflow-wrap:anywhere;font-size:12px;margin:10px 0;}section{border-top:1px solid var(--dw-border);margin-top:16px;padding-top:12px;}p{overflow-wrap:anywhere;line-height:1.5;}</style>
