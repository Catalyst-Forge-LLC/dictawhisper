<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import { transcriptionReview, reviewClock, createReviewPlayback } from '../transcriptionReview.js';
  export let quality, segments = [], audio = null, transcriptLabel = 'Original transcript', improve = null, improveLabel = 'Improve audio & retranscribe';
  const dispatch = createEventDispatcher();
  let open = false, index = 0, previousQuality, playing = false, error = '';
  const playback = createReviewPlayback(state => { playing = state.playing; error = state.error; });
  $: review = transcriptionReview(quality, segments);
  $: if (quality !== previousQuality) { previousQuality = quality; index = 0; playback.stop(); }
  $: selected = review.passages[Math.min(index, review.passages.length - 1)];
  function choose(value) { playback.stop(); index = Math.max(0, Math.min(review.passages.length - 1, Number(value))); }
  function listen() {
    if (playing) { playback.stop(); return; }
    dispatch('listen'); playback.play(audio, selected);
  }
  onDestroy(() => playback.stop());
</script>

{#if quality}
  <details class="quality" bind:open on:toggle={() => { if (!open) playback.stop(); }}>
    <summary><span class="summary-label"><AppIcon name="waveform" />{review.passages.length ? 'Check transcript' : 'Transcription details'}{#if review.passages.length}<span class="count">{review.passages.length} {review.passages.length === 1 ? 'passage' : 'passages'}</span>{/if}</span></summary>
    {#if selected}
      <p class="muted intro">Listen to any passage you’re unsure about. These flags are suggestions, not confirmed errors.</p>
      <div class="navigation" role="group" aria-label="Review passages">
        <button class="dw-btn-secondary" disabled={index === 0} on:click={() => choose(index - 1)} aria-label="Previous flagged passage"><AppIcon name="left" /><span>Previous</span></button>
        <select class="dw-input" aria-label="Passage to review" value={index} on:change={event => choose(event.currentTarget.value)}>
          {#each review.passages as row, n}<option value={n}>{n + 1} of {review.passages.length} · {reviewClock(row.issue.start)} · {row.label}</option>{/each}
        </select>
        <button class="dw-btn-secondary" disabled={index === review.passages.length - 1} on:click={() => choose(index + 1)} aria-label="Next flagged passage"><span>Next</span><AppIcon name="chevron" /></button>
      </div>
      <div class="passage">
        <div class="passage-heading">
          <div aria-live="polite" aria-atomic="true"><strong>{selected.label}</strong><span class="position">{index + 1} of {review.passages.length} · {reviewClock(selected.issue.start)}</span></div>
          <button class="dw-btn-secondary play" disabled={!audio} on:click={listen}><AppIcon name={playing ? 'stop' : 'play'} />{playing ? 'Stop passage' : 'Play passage'}</button>
        </div>
        <p class="reason">{selected.issue.message}</p>
        <p class="muted clip">Plays {reviewClock(selected.start)}–{reviewClock(selected.end)} with nearby audio, then stops.{#if selected.truncated} Preview limited to 45 seconds.{/if}</p>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if !audio}<p class="muted">Audio playback is unavailable here.</p>{/if}
        <div class="comparison">
          <section aria-label={transcriptLabel}><h4>{transcriptLabel}</h4>
            {#if selected.text}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable text needs keyboard access) -->
              <div class="excerpt" tabindex="0" role="region" aria-label={transcriptLabel + ' excerpt'}>{selected.text}</div>
            {:else}<p class="muted">No timed transcript text overlaps this passage. Listen to check what’s there.</p>{/if}
          </section>
          {#if typeof selected.issue.alternative === 'string'}
            <section aria-label="Alternate transcription"><h4>Alternate transcription</h4>
              {#if selected.issue.alternative.trim()}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable text needs keyboard access) -->
                <div class="excerpt" tabindex="0" role="region" aria-label="Alternate transcription excerpt">{selected.issue.alternative}</div>
              {:else}<p class="muted">The second pass returned no speech.</p>{/if}
              <p class="muted explanation">A second transcription pass, which may include nearby words. Your saved text is unchanged.</p>
            </section>
          {:else if selected.issue.retryError}<section><h4>Alternate unavailable</h4><p class="muted">The second pass could not finish. You can still listen to this passage.</p><details><summary>Error details</summary><p class="error-detail">{selected.issue.retryError}</p></details></section>{/if}
        </div>
        {#if improve}<div class="next-step"><span class="muted">Words still wrong?</span><button class="dw-text-btn" on:click={event => { playback.stop(); improve(event); }}>{improveLabel}<AppIcon name="chevron" size={14}/></button></div>{/if}
      </div>
    {:else if !review.notes.length}<p class="muted">No automatic flags were found. You can still check the transcript by listening.</p>{/if}
    {#if review.notes.length}<details class="recording-notes"><summary>Recording notes · {review.notes.length}</summary><ul>{#each review.notes as note}<li>{note.message}{#if note.count > 1} ({note.count} occurrences){/if}</li>{/each}</ul></details>{/if}
    <details class="processing"><summary>Processing details</summary>
      <p>Whisper {quality.model || 'unknown model'} · {quality.preparation?.selectedPreset || 'unfiltered'} audio · pipeline {quality.version ?? 'unknown'}</p>
      {#if quality.preparation?.assessment?.reasons?.length}<p>{quality.preparation.assessment.reasons.join(' ')}</p>{/if}
      <p class="muted">Alternate transcription is only available for some passages. Moving between passages does not mark them as reviewed or change your transcript.</p>
    </details>
  </details>
{/if}

<style>
  .quality{border-top:1px solid var(--dw-border);margin:8px 0;font-size:13px;min-width:0;}
  summary{min-height:40px;align-content:center;cursor:pointer;font-weight:600;color:var(--dw-accent-bright);}
  .summary-label{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;vertical-align:middle;}
  .count{font-size:12px;font-weight:400;color:var(--dw-text-muted);}
  p{margin:6px 0;line-height:1.5;overflow-wrap:anywhere;} .muted,.position{color:var(--dw-text-muted);}
  .intro{margin:0 0 10px;} .navigation{display:flex;align-items:center;gap:8px;margin:0 0 10px;}
  button{min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0;}
  select{min-width:0;flex:1;width:0;min-height:44px;font-size:13px;padding:8px;}
  .passage{padding:12px;border:1px solid var(--dw-border);border-radius:8px;background:rgb(255 255 255 / .025);}
  .passage-heading{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;}
  .position{display:block;font-size:12px;margin-top:2px;} .play{color:var(--dw-accent-bright);}
  .reason{margin-top:8px;} .clip{font-size:12px;margin-bottom:12px;}
  .comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;}
  section{min-width:0;} h4{margin:0 0 6px;font-size:12px;font-weight:600;}
  .excerpt{line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;max-height:10rem;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:6px;}
  .explanation{font-size:12px;} .error{color:var(--dw-danger,#fca5a5);}
  .next-step{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;border-top:1px solid var(--dw-border);margin-top:10px;padding-top:4px;font-size:12px;}.next-step button{white-space:normal;text-align:left;}
  .error-detail{max-height:6rem;overflow:auto;}
  .processing{color:var(--dw-text-muted);} .processing summary,.recording-notes summary{font-size:12px;color:var(--dw-text-muted);}
  ul{margin:0 0 8px;padding-left:20px;max-height:10rem;overflow:auto;overflow-wrap:anywhere;} li{margin:6px 0;}
  summary:focus-visible,.excerpt:focus-visible{outline:2px solid var(--dw-accent-bright);outline-offset:2px;}
  @media(max-width:600px){.navigation button{width:44px;padding:8px;}.navigation button span{display:none;}.excerpt{max-height:7rem;}.passage{padding:10px;}}
</style>
