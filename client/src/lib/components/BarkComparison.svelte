<script>
  import AppIcon from './AppIcon.svelte';
  export let job;
  export let audio;
  let selected = 0, message = '';
  $: experiment = job.experiment;
  $: timed = experiment?.timing === 'model-token-estimates' && job.segments?.length > 0;
  $: passages = timed ? job.segments : experiment?.windows || [];
  $: passage = passages[selected];
  const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function choose(index) { audio?.pause(); selected = index; message = ''; }
  async function play() {
    if (!audio || !passage) return;
    audio.currentTime = passage.start;
    try { await audio.play(); message = ''; }
    catch { message = 'Press Play in the audio player to listen.'; }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(job.text); message = 'Bark transcript copied.'; }
    catch { message = 'Copy was blocked. Select the text in Full transcript comparison below.'; }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({text:job.text,segments:job.segments,asr:experiment},null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `bark-comparison-${job.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<section class="experiment" aria-label="Bark Pro comparison">
  <h3><AppIcon name="waveform"/>Listen and compare</h3>
  <p>Raw model output; your saved transcript stays in use. Check for missed or added words as you listen.</p>
  <p class="muted">{timed ? 'Passage times are Bark’s estimates. Check alignment by listening.' : 'Passage timing is unavailable. Recording windows locate the input audio, not individual words.'}</p>
  {#if passage}
    <label>{timed ? 'Passage' : 'Recording window'}<select class="dw-input" value={selected} on:change={event => choose(Number(event.target.value))}>{#each passages as part, index}<option value={index}>{index + 1} of {passages.length} · {clock(part.start)} · {part.text.slice(0, 65)}</option>{/each}</select></label>
    <div class="passage" role="region" aria-label="Selected Bark passage" tabindex="0">{passage.text || 'No speech returned for this window.'}</div>
    <div class="controls">
      <button class="dw-btn-secondary" disabled={selected === 0} on:click={() => choose(selected - 1)}><AppIcon name="left"/>Previous</button>
      <button class="dw-btn-primary" disabled={!audio} on:click={play}><AppIcon name="play"/>Play from {clock(passage.start)}</button>
      <button class="dw-btn-secondary" disabled={selected === passages.length - 1} on:click={() => choose(selected + 1)}>Next<AppIcon name="chevron"/></button>
    </div>
  {/if}
  <div class="controls"><button class="dw-text-btn" on:click={copy}><AppIcon name="copy"/>Copy Bark text</button><button class="dw-text-btn" on:click={download}><AppIcon name="download"/>Download comparison JSON</button></div>
  <p class="message" role="status">{message}</p>
  {#if experiment}<details><summary>Run details · {experiment.totalSeconds.toFixed(1)}s processing for {clock(experiment.durationSec)} audio</summary>
    <p class="muted">Model load: {experiment.loadSeconds.toFixed(1)}s · inference: {experiment.inferenceSeconds.toFixed(1)}s · {experiment.device} · {experiment.dtype} · {experiment.runtime}</p>
    <p class="muted">Long recordings use contiguous windows of up to {experiment.chunkSeconds}s, cut near a quiet point. Check words across window boundaries; context can be lost there.</p>
    <p class="muted">{experiment.model}<br/>Revision: <code>{experiment.revision}</code></p>
    {#each experiment.warnings || [] as warning}<p class="muted">{warning}</p>{/each}
  </details>{/if}
</section>

<style>
  .experiment{border:1px solid var(--dw-border);border-radius:8px;padding:16px;margin-top:16px;}h3{display:flex;align-items:center;gap:8px;font-size:16px;margin:0;}p{line-height:1.5;overflow-wrap:anywhere;} .muted{color:var(--dw-text-muted);font-size:13px;}
  label{display:flex;gap:10px;align-items:center;font-size:14px;}select{flex:1;min-width:0;max-width:100%;}.passage{white-space:pre-wrap;max-height:180px;overflow:auto;padding:12px;margin:12px 0;line-height:1.5;overflow-wrap:anywhere;background:var(--dw-surface-raised);border-radius:6px;}
  .controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}button{display:inline-flex;gap:6px;align-items:center;min-height:44px;}.message:empty{display:none;}summary{cursor:pointer;padding:8px 0;font-size:13px;}code{overflow-wrap:anywhere;}
  :is(button,select,summary,.passage):focus-visible{outline:2px solid var(--dw-focus);outline-offset:3px;}@media(max-width:600px){label{flex-direction:column;align-items:stretch;}.experiment{padding:12px;}}
</style>
