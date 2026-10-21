<script>
  export let quality, listen = null;
  const clock = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
</script>
{#if quality}
  <details class="quality">
    <summary>{quality.issues?.length ? `Review ${quality.issues.length} transcription ${quality.issues.length === 1 ? 'signal' : 'signals'}` : 'Transcription details'}</summary>
    <p>Whisper {quality.model} · {quality.preparation?.selectedPreset || 'unfiltered'} audio · pipeline {quality.version}</p>
    {#if quality.preparation?.assessment}<p>{quality.preparation.assessment.reasons.join(' ')}</p>{/if}
    {#if quality.issues?.length}<p class="muted">These are listening prompts, not an accuracy score. Alternate passes leave the original text intact.</p>
      {#each quality.issues as issue}<div class="issue"><p>{issue.message} {#if Number.isFinite(issue.start)}{#if listen}<button class="dw-text-btn" on:click={event => listen(event, {start:issue.start,end:issue.end})}>Play {clock(issue.start)}</button>{:else}<span>At {clock(issue.start)}</span>{/if}{/if}</p>{#if issue.alternative !== undefined}<details><summary>Alternate listen</summary><p class="alternate">{issue.alternative || 'No speech returned in this alternate pass.'}</p></details>{/if}{#if issue.retryError}<p class="muted">Alternate pass unavailable: {issue.retryError}</p>{/if}</div>{/each}
    {:else}<p class="muted">No automatic review signals were found. This does not guarantee that every word is correct.</p>{/if}
  </details>
{/if}
<style>
  .quality{border-top:1px solid var(--dw-border);margin:8px 0;font-size:13px;} summary{min-height:36px;align-content:center;cursor:pointer;font-weight:600;color:var(--dw-accent-bright);} p{margin:8px 0;line-height:1.5;overflow-wrap:anywhere;} .muted{color:var(--dw-text-muted);} .issue{padding:8px 12px;border-left:2px solid var(--dw-border);margin:10px 0;} button{min-height:36px;} .alternate{white-space:pre-wrap;} summary:focus-visible{outline:2px solid var(--dw-accent-bright);outline-offset:2px;}
</style>
