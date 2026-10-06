<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { createCaptureSession, createImportQueue } from '../captureSession.js';
  export let connected = false;
  const dispatch = createEventDispatcher();
  let open = false, closeChoice = false, dragOver = false, fileInput, recordButton;
  let capabilities = null, capabilitiesError = '', rows = [], capture = { phase: 'idle', draft: null, error: '', elapsed: 0 };
  let session, queue, draftUrl = '', draftIdentity = '', timer, inputLevel = 0, audioContext, analyser;
  const formatTime = ms => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
  async function loadCapabilities() {
    try { const response = await fetch('/audio/capabilities'); if (!response.ok) throw new Error('Unable to check upload capabilities.'); capabilities = await response.json(); capabilitiesError = ''; }
    catch (error) { capabilitiesError = error.message; }
  }
  async function upload(file, uploadId, name = file.name || `voice-recording_${new Date().toISOString().replace(/[:.]/g,'-')}.webm`) {
    if (!connected) throw new Error('Connection lost. Your audio is retained. Reconnect before saving.');
    // Resolve an unknown previous outcome before sending the same identity again.
    const lookup = await fetch(`/audio/upload?uploadId=${encodeURIComponent(uploadId)}`);
    if (!lookup.ok) throw new Error('Cannot verify whether audio was saved. Reconnect and retry.');
    const previous = await lookup.json();
    if (previous.found) return { saved: true, file: previous.item.audioFile, item: previous.item };
    const form = new FormData(); form.append('file', file, name); form.append('uploadId', uploadId);
    const response = await fetch('/audio', { method: 'POST', body: form }); const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Upload failed (${response.status}).`);
    dispatch('accepted', data); return data;
  }
  function captureChanged(next) {
    const started = next.phase === 'recording' && capture.phase !== 'recording';
    capture = next;
    if (next.draft && !draftUrl) { draftUrl = URL.createObjectURL(next.draft); draftIdentity = crypto.randomUUID(); }
    if (!next.draft && draftUrl) { URL.revokeObjectURL(draftUrl); draftUrl = ''; draftIdentity = ''; }
    if (started) {
      document.querySelectorAll('audio').forEach(audio=>audio.pause()); window.dispatchEvent(new Event('dw-recording-started'));
      try { audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = 256; audioContext.createMediaStreamSource(session.stream).connect(analyser); } catch { /* Recording works even without a level meter. */ }
    }
    if (!['recording','requesting'].includes(next.phase)) { void audioContext?.close(); audioContext = null; analyser = null; inputLevel = 0; }
  }
  async function record() { open = true; closeChoice = false; if (!capture.draft && !['recording','requesting','uploading'].includes(capture.phase)) await session.start(); }
  function close() { if (capture.phase === 'recording' || capture.phase === 'requesting') { closeChoice = true; return; } open = false; closeChoice = false; recordButton?.focus({preventScroll:true}); }
  function files(list) { if (!list?.length) return; open = true; queue.add(Array.from(list)); }
  function openSaved(item) { open=false;closeChoice=false;dispatch('openentry',item); }
  function beforeUnload(event) { if (capture.draft || ['recording','requesting','uploading'].includes(capture.phase) || queue?.unsaved) { event.preventDefault(); event.returnValue = ''; } }
  function drag(event) { if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return; event.preventDefault(); dragOver = true; }
  onMount(() => {
    session = createCaptureSession({ media: navigator.mediaDevices, Recorder: window.MediaRecorder, secure: window.isSecureContext, onChange: captureChanged });
    queue = createImportQueue({ upload, capabilities: () => capabilities, onChange: next => rows = next });
    void loadCapabilities();
    timer = setInterval(() => { session.tick(); if (analyser) { const sample = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(sample); inputLevel = Math.min(100, Math.max(...sample.map(value => Math.abs(value-128))) / 128 * 100); } }, 250);
    window.addEventListener('beforeunload', beforeUnload);
  });
  onDestroy(() => { clearInterval(timer); session?.destroy(); queue?.destroy(); void audioContext?.close(); if (draftUrl) URL.revokeObjectURL(draftUrl); if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnload); });
</script>
<svelte:window on:dragover={drag} on:dragleave={event => { if (!event.relatedTarget) dragOver = false; }} on:drop={event => { if (event.dataTransfer?.files.length) { event.preventDefault(); dragOver = false; files(event.dataTransfer.files); } }} on:keydown={event => { if (event.key === 'Escape' && open && !document.querySelector('dialog[open]')) { event.preventDefault(); close(); } }} />
<section class="capture" aria-label="Record or import audio">
  <button bind:this={recordButton} class="dw-btn-secondary dw-btn-compact record-button" class:recording={capture.phase === 'recording'} aria-label={capture.draft?'Record, draft retained':capture.phase==='recording'?'Record, recording in progress':'Record'} title={capture.draft?'Recording draft retained':capture.phase==='recording'?'Recording in progress':'Record audio'} aria-expanded={open} aria-controls="audio-capture" on:click={record}>Record{#if capture.phase === 'recording' || capture.draft}<span class="capture-indicator" aria-hidden="true">●</span>{/if}</button>
  <button class="dw-btn-secondary dw-btn-compact" on:click={() => fileInput?.click()}>Import</button>
  <input class="file-input" type="file" multiple accept={capabilities?.formats.map(ext=>'.'+ext).join(',') || 'audio/*'} bind:this={fileInput} on:change={event => { files(event.target.files); event.target.value = ''; }} />
  {#if dragOver}<div class="drop-target">Drop audio to import</div>{/if}
  {#if open}<section id="audio-capture" class="capture-panel" aria-label="Audio capture">
    <header><h2>Record or import</h2><button class="dw-btn-secondary" on:click={close}>Close capture</button></header>
    {#if closeChoice}<div role="status"><p>Recording has not been discarded.</p><button class="dw-btn-secondary" on:click={() => { open = false; closeChoice = false; }}>Keep recording</button><button class="dw-btn-secondary" on:click={() => { closeChoice = false; if(capture.phase==='requesting')session.discard();else session.stop(); }}>{capture.phase==='requesting'?'Cancel microphone request':'Stop and review'}</button></div>{/if}
    {#if capture.phase === 'requesting'}<p role="status">Requesting microphone…</p>
    {:else if capture.phase === 'recording'}<p role="timer">Recording · {formatTime(capture.elapsed)}</p><meter min="0" max="100" value={inputLevel} aria-label="Microphone input level"></meter><div class="actions"><button class="dw-btn-primary" on:click={() => session.stop()}>Stop</button><button class="dw-btn-secondary" on:click={() => session.discard()}>Discard recording</button></div>
    {:else if capture.phase === 'stopping'}<p role="status">Preparing recording draft…</p>
    {:else if capture.draft}<p>Recording draft · {formatTime(capture.elapsed)} · {(capture.draft.size/1024).toFixed(0)} KiB</p><audio controls on:play={event=>document.querySelectorAll('audio').forEach(audio=>{if(audio!==event.currentTarget)audio.pause();})} src={draftUrl}></audio><div class="actions"><button class="dw-btn-primary" disabled={!connected || !capabilities?.canSave || capture.phase === 'uploading'} on:click={() => session.save(blob => upload(blob, draftIdentity))}>{capture.phase === 'uploading' ? 'Saving…' : capture.error ? 'Retry save' : 'Save recording'}</button><a class="dw-btn-secondary" href={draftUrl} download={'recording.'+({ 'audio/wav':'wav','audio/mp4':'m4a','audio/ogg':'ogg' }[capture.draft.type] || 'webm')}>Download recording</a><button class="dw-btn-secondary" disabled={capture.phase === 'uploading'} on:click={() => session.discard()}>Discard draft</button><button class="dw-text-btn" disabled={capture.phase === 'uploading'} on:click={() => { session.discard(); record(); }}>Discard and record again</button></div>
    {:else if capture.phase === 'accepted'}<p role="status">Recording saved · Waiting to transcribe</p><div class="actions"><button class="dw-btn-secondary" on:click={() => openSaved(capture.accepted.item)}>Open entry</button><button class="dw-text-btn" on:click={() => {open=false;dispatch('activity');}}>View activity</button><button class="dw-text-btn" on:click={record}>Record another</button></div>
    {:else}<button class="dw-btn-secondary" on:click={record}>Try recording</button>{/if}
    {#if capture.error}<p class="dw-error" role="alert">{capture.error}</p>{/if}
    {#if !connected}<p role="status">Connection lost · Reconnecting. Drafts stay in this tab; saving waits for connection.</p>{/if}
    {#if capabilities}<p class="dw-muted">Supported: {capabilities.formats.join(', ').toUpperCase()} · Maximum {Math.round(capabilities.maxBytes/1024/1024)} MiB per file. {capabilities.reason}</p>{:else}<p class="dw-error">{capabilitiesError || 'Checking supported formats…'} <button class="dw-text-btn" on:click={loadCapabilities}>Check again</button></p>{/if}
    <button class="dw-btn-secondary" disabled={!capabilities?.canSave} on:click={() => fileInput?.click()}>Import audio</button>
    {#each rows as row (row.id)}<div class="import-row"><strong>{row.name}</strong><span>{(row.size/1024/1024).toFixed(1)} MiB · {row.state === 'saved' ? 'Saved · Processing shown in Activity' : row.state === 'failed' ? 'Failed' : row.state === 'uploading' ? 'Uploading…' : 'Preparing…'}</span>{#if row.error}<p class="dw-error" role="alert">{row.error}</p>{/if}<div class="actions">{#if row.state === 'failed'}<button class="dw-btn-secondary" disabled={!connected} on:click={() => queue.retry(row.id)}>Retry {row.name}</button>{/if}{#if row.state === 'saved'}<button class="dw-btn-secondary" on:click={() => openSaved(row.result.item)}>Open {row.name}</button>{/if}<button class="dw-text-btn" disabled={row.state === 'uploading'} on:click={() => queue.remove(row.id)}>Remove {row.name}</button></div></div>{/each}
  </section>{/if}
</section>
<style>
  .capture { display:flex; align-items:center; gap:8px; }
  .recording { color:var(--dw-accent-bright); }
  .record-button {position:relative;}
  .capture-indicator {position:absolute;right:3px;top:1px;font-size:8px;color:var(--dw-accent-bright);}
  .file-input { display:none; }
  .capture-panel { position:fixed; z-index:35; right:12px; top:60px; width:min(520px,calc(100vw - 24px)); max-height:calc(100dvh - 80px); overflow:auto; padding:16px; background:#18181b; border:1px solid var(--dw-border); border-radius:10px; box-shadow:0 12px 50px #000b; display:flex; flex-direction:column; gap:12px; }
  header, .actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  header h2 { flex:1; font-size:16px; } audio { width:100%; } meter { width:100%; }
  .import-row { padding:12px 0; border-top:1px solid var(--dw-border); display:flex; flex-direction:column; gap:6px; overflow-wrap:anywhere; }
  .drop-target { pointer-events:none; position:fixed; inset:64px 16px 16px; z-index:40; background:#191915e8; border:2px dashed var(--dw-accent); display:grid; place-items:center; font-size:24px; }
  .capture-panel button, .capture-panel a { min-height:44px; }
  @media(max-width:599px) { .capture { gap:4px; } }
</style>
