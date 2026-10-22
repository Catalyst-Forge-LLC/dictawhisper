<script>
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import TranscriptionQuality from './TranscriptionQuality.svelte';
  import BarkComparison from './BarkComparison.svelte';
  export let file;
  export let initialAttemptId = '';
  const dispatch = createEventDispatcher();
  const presets = [
    { id: 'auto', name: 'Automatic · recommended', description: 'Measure the recording and choose unfiltered audio, gain or leveling.' },
    { id: 'quiet', name: 'Quiet speech', description: 'Raise the level while protecting loud peaks.' },
    { id: 'uneven', name: 'Uneven volume', description: 'Lift quiet passages and balance changing levels.' },
    { id: 'noise', name: 'Background noise', description: 'Reduce steady noise and low rumble, then level speech.' },
    { id: 'original', name: 'Unfiltered original', description: 'Transcribe the source again without enhancement.' },
  ];
  const phases = { preparing: 'Preparing audio preview…', preview: 'Audio preview ready', transcribing: 'Waiting for the transcription engine or transcribing…', ready: 'New transcript ready to review', applied: 'Improved version saved', reverted: 'Previous version restored', discarded: 'Current version kept', failed: 'This attempt needs attention' };
  const modelLabel = value => value === 'bark-pro' ? 'Bark Pro' : `Whisper ${value}`;
  let dialog, audio, heading, priorFocus, timer, alive = true, request = 0;
  let loading = true, busy = false, error = '', result = null, attemptId = initialAttemptId, showSetup = false;
  let preset = 'auto', model = 'bark-pro', defaultLoaded = false, vadFilter = false, variant = 'enhanced', position = 0, resume = false;
  $: job = result?.job;
  $: comparisonOnly = job?.comparisonOnly;
  $: running = ['preparing', 'transcribing'].includes(job?.phase);
  $: previewAvailable = ['preview', 'transcribing', 'ready', 'applied'].includes(job?.phase) || job?.phase === 'failed' && job?.failedStage === 'transcribing';
  $: audioSource = job && previewAvailable ? `/notes/audio-improvement/audio?file=${encodeURIComponent(file)}&id=${job.id}&variant=${variant}` : '';
  $: activeHistory = result?.history?.find(row => row.id === result.activeVersionId);
  onMount(() => {
    priorFocus = document.activeElement;
    for (const player of document.querySelectorAll('audio')) player.pause();
    dialog.showModal(); heading?.focus(); void refresh();
    const pause = () => audio?.pause(); window.addEventListener('dw-recording-started', pause);
    return () => window.removeEventListener('dw-recording-started', pause);
  });
  onDestroy(() => { alive = false; request++; clearTimeout(timer); audio?.pause(); if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true }); });
  async function decode(response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update this attempt.');
    return data;
  }
  function schedule() {
    clearTimeout(timer);
    if (alive && ['preparing', 'transcribing'].includes(result?.job?.phase)) timer = setTimeout(refresh, 1800);
  }
  async function refresh() {
    const sequence = ++request;
    loading = true;
    try {
      const data = await decode(await fetch(`/notes/audio-improvement?file=${encodeURIComponent(file)}${attemptId ? '&id=' + attemptId : ''}`, { cache: 'no-store' }));
      if (!alive || sequence !== request) return;
      result = data; error = '';
      if (!defaultLoaded) { model = data.defaultModel || 'bark-pro'; defaultLoaded = true; }
      if (!attemptId && data.job) attemptId = data.job.id;
      if (!data.job || ['discarded', 'reverted'].includes(data.job.phase)) showSetup = true;
      schedule();
    } catch (e) { if (alive && sequence === request) error = e.message || 'Could not check this attempt. Reconnect and refresh; saved work is kept.'; }
    finally { if (alive && sequence === request) loading = false; }
  }
  async function act(action, extra = {}) {
    if (busy || loading || attemptId && job?.id !== attemptId) return;
    busy = true; error = ''; clearTimeout(timer); const sequence = ++request;
    try {
      const data = await decode(await fetch('/notes/audio-improvement/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, id: attemptId, ...extra }) }));
      if (!alive || sequence !== request) return;
      result = data; attemptId = data.job?.id || ''; showSetup = false;
      if (action === 'prepare') { variant = 'enhanced'; position = 0; resume = false; }
      if (['apply', 'restore', 'discard'].includes(action)) dispatch('changed');
      schedule(); await tick(); heading?.focus({ preventScroll: true });
    } catch (e) {
      if (alive) {
        // Refresh the actual comparison after a race, not just its status label.
        if (action === 'apply') await refresh();
        error = e.message || 'The request could not be confirmed. Refresh status to check the saved result.';
      }
    }
    finally { if (alive) busy = false; }
  }
  function close() { if (!busy) dispatch('close'); }
  function createReadable() { if (!busy) { dispatch('cleanup'); close(); } }
  function switchAudio(next) {
    if (next === variant) return;
    position = audio?.currentTime || 0; resume = Boolean(audio && !audio.paused); audio?.pause(); variant = next;
  }
  function loaded() {
    audio.currentTime = Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position);
    if (resume) { resume = false; void audio.play().catch(() => { error = 'Press Play to continue the preview.'; }); }
  }
  function startAnother() { showSetup = true; if (job) { preset = job.preset; model = job.model; vadFilter = job.vadFilter; } }
</script>

<dialog bind:this={dialog} aria-labelledby="audio-improvement-heading" on:cancel|preventDefault={close}>
  <header>
    <div><p class="eyebrow">AUDIO & TRANSCRIPTION</p><h2 id="audio-improvement-heading" bind:this={heading} tabindex="-1">{job?.phase === 'ready' && !showSetup ? comparisonOnly ? 'Compare Bark Pro' : 'Review new transcript' : 'Improve audio & retranscribe'}</h2></div>
    <button class="dw-btn-secondary" disabled={busy} on:click={close}>Close</button>
  </header>
  <div class="content">
    {#if !(comparisonOnly && job?.phase === 'ready' && !showSetup)}<p class="intro">{comparisonOnly && !showSetup ? 'Compare Bark Pro with your saved transcript. This result is kept separately because passage timing is unavailable.' : job?.phase === 'ready' && !showSetup ? 'The entry still uses your saved version. Compare it with the new transcript, then choose which to keep.' : 'Prepare a listening preview, then create a new transcript. Your current version stays in place until you choose the new one.'}</p>{/if}
    {#if loading}<p role="status">Checking saved attempts…</p>{/if}
    {#if error}<div class="error" role="alert"><p>{error}</p><button class="dw-btn-secondary" disabled={busy} on:click={refresh}>Refresh status</button></div>{/if}
    {#if !loading && (showSetup || !job)}
      <fieldset disabled={busy || running}>
        <legend>What needs improving?</legend>
        <div class="preset-grid">{#each presets as choice}<label class:selected={preset === choice.id}><input type="radio" name="audio-preset" value={choice.id} bind:group={preset} /><span><strong>{choice.name}</strong><small>{choice.description}</small></span></label>{/each}</div>
        <label class="model">Transcription model<select class="dw-input" bind:value={model} on:change={event => { if (event.currentTarget.value === 'bark-pro') vadFilter = false; }}><option value="bark-pro">Bark Pro · English</option><option value="large-v3">Whisper large-v3 · multilingual</option><option value="turbo">Whisper turbo · faster</option></select></label>
        {#if model === 'bark-pro'}<p class="muted">English only. Runs locally and includes quiet speech and silence. Listen and compare before replacing your saved version. Results without usable passage timing stay available for comparison only.</p>{#if !result?.bark?.available}<p role="status">{result?.bark?.reason || 'Bark Pro setup is required.'}</p><button class="dw-btn-secondary" type="button" on:click={refresh}>Check Bark setup</button>{/if}
        {:else}<details><summary>Speech detection</summary><label class="check"><input type="checkbox" bind:checked={vadFilter} />Skip silence during transcription</label><p class="muted">Leave off for very faint speech. Including silence can also produce incorrect words, so review the result.</p></details>{/if}
      </fieldset>
      <div class="actions"><button class="dw-btn-primary" disabled={busy || running || model === 'bark-pro' && !result?.bark?.available} on:click={() => act('prepare', { preset, model, vadFilter })}>Prepare audio preview</button>{#if job && !['discarded', 'reverted'].includes(job.phase)}<button class="dw-text-btn" disabled={busy} on:click={() => showSetup = false}>Back to saved attempt</button>{/if}</div>
    {/if}
    {#if job && !showSetup}
      {#if result.pending?.length > 1 && result.pending.some(candidate => candidate.id === job.id)}<label class="model">Saved candidates<select class="dw-input" disabled={busy || running} value={attemptId} on:change={event => { attemptId = event.target.value; void refresh(); }}>{#each result.pending as candidate}<option value={candidate.id}>{modelLabel(candidate.model)} · started {new Date(candidate.createdAt).toLocaleString()}</option>{/each}</select></label>{/if}
      <div class="status">{#if !(comparisonOnly && job.phase === 'ready')}<h3 role="status">{phases[job.phase]}</h3>{/if}<p class="muted">{presets.find(row => row.id === job.preset)?.name} · {modelLabel(job.model)}</p></div>
      {#if running}<p>You can close this window and keep browsing. Reopen this action on the entry to check progress.</p>{/if}
      {#if job.error}<p class="error" role="alert">{job.error}</p>{/if}
      {#if previewAvailable}
        <section class="preview" aria-label="Compare audio">
          <div class="preview-head"><h3>Listen at the same position</h3><div class="dw-segmented" role="group" aria-label="Preview audio version"><button aria-pressed={variant === 'source'} class:is-on={variant === 'source'} on:click={() => switchAudio('source')}>{job.sourceOriginal ? 'Original' : 'Available source'}</button><button aria-pressed={variant === 'enhanced'} class:is-on={variant === 'enhanced'} on:click={() => switchAudio('enhanced')}>{job.preset === 'original' ? 'Prepared copy' : 'Enhanced'}</button></div></div>
          <audio bind:this={audio} controls preload="metadata" src={audioSource} on:loadedmetadata={loaded} on:play={() => { for (const player of document.querySelectorAll('audio')) if (player !== audio) player.pause(); }} on:error={() => error = 'The audio preview could not load. Refresh status or start a new attempt.'}></audio>
          {#if !job.sourceOriginal}<p class="muted">No separate original was found. This attempt uses the available recording; it may already have been processed.</p>{/if}
          {#if job.report?.warning}<p>{job.report.warning}</p>{/if}
          {#if job.report}<details><summary>Audio measurements · {job.report.selectedPreset || job.preset}</summary><p class="muted">Average {job.report.meanDb.toFixed(1)} dB · peak {job.report.peakDb.toFixed(1)} dB{job.report.gainDb ? ` · boost ${job.report.gainDb.toFixed(1)} dB` : ''}. PCM working copy; duration preserved.</p>{#if job.report.assessment}<p class="muted">{job.report.assessment.reasons.join(' ')}</p>{/if}</details>{/if}
        </section>
      {/if}
      {#if job.phase === 'preview' || job.phase === 'failed' && job.failedStage === 'transcribing'}
        {#if !result.transcriptionEnabled}<p role="status">Transcription is disabled in Settings. Enable it to create a transcript.</p>{/if}
        <div class="actions"><button class="dw-btn-primary" disabled={busy || !result.transcriptionEnabled} on:click={() => act('transcribe')}>{job.phase === 'failed' ? 'Retry transcription' : 'Create new transcript'}</button><button class="dw-text-btn" disabled={busy} on:click={startAnother}>Try another preset</button><button class="dw-text-btn" disabled={busy} on:click={() => act('discard')}>Discard attempt</button></div>
      {:else if job.phase === 'ready'}
        {#if result.currentChanged}<div class="review-warning" role="status"><strong>Your saved version changed after this attempt began.</strong><p>Compare the latest saved text below with this candidate. Accepting replaces that saved transcript and its readable cleanup; a copy is kept for Undo. You do not need to transcribe again.</p></div>{/if}
        {#if job.model === 'bark-pro'}
          {#key job.id}<BarkComparison {job} {audio}/>{/key}
          {#if job.quality?.issues?.length}<TranscriptionQuality quality={job.quality} segments={job.segments || []} {audio} transcriptLabel="Candidate transcript" improve={busy ? null : startAnother} improveLabel="Try another setup"/>{/if}
          <details open={result.currentChanged}><summary>Full transcript comparison</summary><div class="transcript-compare"><section aria-label="Current transcript"><h3>Current transcript</h3><textarea class="transcript" aria-label="Current transcript text" readonly rows="10" value={result.currentText || 'No current transcript.'}></textarea></section><section aria-label="Bark transcript"><h3>Bark Pro · raw output</h3><textarea class="transcript" aria-label="Bark transcript text" readonly rows="10" value={job.text}></textarea></section></div></details>
          {#if result.currentChanged && result.currentReadableText}<details><summary>Current readable cleanup · replaced on acceptance</summary><textarea class="transcript" aria-label="Current readable cleanup text" readonly rows="6" value={result.currentReadableText}></textarea></details>{/if}
          {#if comparisonOnly}<p role="status">This result has no usable passage timing, so it cannot replace the entry. You can keep it for comparison or try Whisper.</p>{:else}<p class="muted">Your title, stars, tags and MayDo decisions stay saved. MayDo audio links need refreshing. Readable cleanup can be generated after acceptance.</p>{/if}
          <div class="actions">{#if !comparisonOnly}<button class="dw-btn-primary" disabled={busy || loading || attemptId !== job.id} on:click={() => act('apply', result.reviewToken ? { reviewToken: result.reviewToken } : {})}>{result.currentChanged ? 'Replace reviewed version' : 'Use new audio & transcript'}</button>{/if}<button class="dw-btn-secondary" disabled={busy} on:click={close}>Keep for later</button><button class="dw-text-btn" disabled={busy} on:click={startAnother}>Try another setup</button><button class="dw-text-btn" disabled={busy || loading || attemptId !== job.id} on:click={() => act('discard')}>Discard candidate</button></div>
        {:else}
        <TranscriptionQuality quality={job.quality} segments={job.segments || []} {audio} transcriptLabel="Candidate transcript" improve={busy ? null : startAnother} improveLabel="Try another preset"/>
        <p>Compare the original machine transcripts below. Readable cleanup can be generated after acceptance.</p>
        <div class="transcript-compare"><section aria-label="Current transcript"><h3>Current transcript</h3><textarea class="transcript" aria-label="Current transcript text" readonly rows="10" value={result.currentText || 'No current transcript.'}></textarea></section><section aria-label="New transcript"><h3>New transcript</h3><textarea class="transcript" aria-label="New transcript text" readonly rows="10" value={job.text}></textarea></section></div>
        {#if result.currentChanged && result.currentReadableText}<details><summary>Current readable cleanup · replaced on acceptance</summary><textarea class="transcript" aria-label="Current readable cleanup text" readonly rows="6" value={result.currentReadableText}></textarea></details>{/if}
        <p class="muted">Your title, stars, tags and MayDo decisions stay saved. Existing MayDo audio links will need refreshing for the new transcript.</p>
        <div class="actions"><button class="dw-btn-primary" disabled={busy || loading || attemptId !== job.id} on:click={() => act('apply', result.reviewToken ? { reviewToken: result.reviewToken } : {})}>{result.currentChanged ? 'Replace reviewed version' : 'Use new audio & transcript'}</button><button class="dw-btn-secondary" disabled={busy || loading || attemptId !== job.id} on:click={() => act('discard')}>Keep current version</button><button class="dw-text-btn" disabled={busy} on:click={startAnother}>Try another preset</button></div>
        {/if}
      {:else if job.phase === 'applied'}
        <p>The entry now uses the prepared audio and new transcript.{#if !result.currentReadableText}{' '}Create readable text to restore punctuation, join speech fragments, remove filler-only pauses, and refresh suggested MayDos.{/if}</p>
        <div class="actions">{#if !result.currentReadableText}<button class="dw-btn-primary" disabled={busy} on:click={createReadable}>Create readable & return to entry</button>{:else}<button class="dw-btn-primary" on:click={close}>Return to entry</button>{/if}{#if result.canUndo}<button class="dw-btn-secondary" disabled={busy} on:click={() => act('restore')}>Undo · restore previous version</button>{/if}<button class="dw-text-btn" disabled={busy} on:click={startAnother}>Start another attempt</button></div>
        <p class="muted">{job.firstImport ? 'This is the first transcript for this recording; there is no previous transcript to restore.' : 'Undo keeps your latest tags and MayDo statuses. It is available until this transcript is changed again; the saved previous version remains on disk.'}</p>
      {:else if job.phase === 'discarded'}
        <p>Your saved audio and transcript are unchanged. This candidate has been removed.</p>
        <div class="actions">{#if result.pending?.length}<button class="dw-btn-secondary" disabled={busy || loading} on:click={() => { attemptId = result.pending[0].id; void refresh(); }}>Review next candidate</button>{/if}<button class="dw-btn-secondary" on:click={close}>Done</button></div>
      {:else if job.phase === 'reverted'}
        <div class="actions"><button class="dw-btn-secondary" disabled={busy} on:click={startAnother}>Start another attempt</button></div>
      {:else if job.phase === 'failed'}
        <div class="actions"><button class="dw-btn-secondary" disabled={busy} on:click={startAnother}>Prepare a new attempt</button><button class="dw-text-btn" disabled={busy} on:click={() => act('discard')}>Discard attempt</button></div>
      {/if}
    {/if}
    {#if activeHistory && (showSetup || job?.id !== activeHistory.id)}<p class="saved-version">An improved version is in use. <button class="dw-text-btn" disabled={busy || running} on:click={() => { attemptId = activeHistory.id; showSetup = false; void refresh(); }}>Review saved version / Undo</button></p>{/if}
  </div>
</dialog>

<style>
  dialog { position: fixed; inset: 0; margin: auto; width: min(960px, calc(100vw - 32px)); max-width: 100vw; max-height: calc(100dvh - 32px); padding: 0; border: 1px solid var(--dw-border); border-radius: 12px; background:var(--dw-surface); color: var(--dw-text); box-sizing: border-box; overflow: auto; }
  dialog::backdrop { background: #000b; }
  header { position: sticky; top: 0; z-index: 2; display: flex; gap: 16px; justify-content: space-between; align-items: center; padding: 16px 24px; background:var(--dw-surface); border-bottom: 1px solid var(--dw-border); }
  h2 { font-size: 22px; line-height: 1.3; margin: 2px 0 0; } h3 { font-size: 16px; margin: 0; }
  .eyebrow { color: var(--dw-accent-bright); font-size: 11px; letter-spacing: .1em; margin: 0; }
  .content { padding: 0 24px 24px; } p { line-height: 1.5; margin: 12px 0; overflow-wrap: anywhere; }
  .intro, .muted { color: var(--dw-text-muted); } .muted { font-size: 13px; }
  fieldset { border: 0; padding: 0; margin: 24px 0 0; min-width: 0; } legend { font-weight: 600; margin-bottom: 12px; }
  .preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .preset-grid label { display: flex; align-items: start; gap: 10px; padding: 14px; border: 1px solid var(--dw-border); border-radius: 8px; cursor: pointer; }
  .preset-grid label.selected { border-color: var(--dw-accent); background: rgb(245 158 11 / .07); }
  input { accent-color: var(--dw-accent); flex-shrink: 0; width: 18px; height: 18px; }
  small { display: block; color: var(--dw-text-muted); font-size: 13px; line-height: 1.4; margin-top: 4px; }
  .model { display: flex; align-items: center; gap: 16px; margin: 20px 0 14px; } select { width: auto; min-width: 0; }
  summary { cursor: pointer; min-height: 36px; padding: 6px 0; } .check { display: flex; align-items: center; gap: 8px; min-height: 44px; }
  button { min-height: 44px; } .actions { position: sticky; bottom: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 20px; padding: 12px 0; background:var(--dw-surface); border-top: 1px solid var(--dw-border); }
  .status { margin: 20px 0 12px; } .status p { margin: 4px 0; }
  .preview { padding: 16px; border: 1px solid var(--dw-border); border-radius: 8px; margin-top: 16px; }
  .preview-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
  audio { display: block; width: 100%; margin: 12px 0 0; height: 44px; }
  .transcript-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .transcript-compare section { min-width: 0; } .transcript-compare h3 { margin-bottom: 8px; }
  .transcript { box-sizing: border-box; width: 100%; resize: vertical; color: var(--dw-text); font-family: inherit; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; font-size: 15px; background: var(--dw-surface-raised); padding: 14px; border: 1px solid var(--dw-border); border-radius: 8px; min-height: 140px; height: clamp(140px, calc(100dvh - 560px), 280px); overflow: auto; }
  .error { color: #fca5a5; } .saved-version { border-top: 1px solid var(--dw-border); padding-top: 12px; }
  .review-warning { padding: 12px 16px; border-left: 3px solid var(--dw-accent); background: rgb(245 158 11 / .07); margin-top: 16px; } .review-warning p { margin: 6px 0 0; }
  :is(button, input, select, summary, .transcript):focus-visible { outline: 2px solid var(--dw-focus); outline-offset: 3px; }
  @media (max-width: 600px) { dialog { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; } header { padding: 12px 16px; } h2 { font-size: 19px; } .content { padding: 0 16px 20px; } .preset-grid, .transcript-compare { grid-template-columns: 1fr; } .transcript-compare section:last-child { order: -1; } .model { align-items: stretch; flex-direction: column; gap: 6px; } .transcript { max-height: 220px; } .actions { bottom: 0; } }
</style>
