<script>
  import { onDestroy, onMount } from 'svelte';

  export let open = false;
  export let noteFilter = 'all';

  let health = null;
  let status = null;
  let probe = null;
  let journal = null;
  let error = '';
  let timer;

  function close() {
    open = false;
  }

  function onKey(event) {
    if (event.key === 'Escape' && open) close();
  }

  function pillClass(level) {
    if (level === 'fail') return 'dw-pill is-fail';
    if (level === 'warn') return 'dw-pill is-warn';
    return 'dw-pill';
  }

  function queueLine(name, queue) {
    if (!queue) return `${name}: off`;
    const waiting = Number(queue.length) || 0;
    const running = Number(queue.running) || 0;
    if (!waiting && !running) return `${name}: idle`;
    return `${name}: ${running} running · ${waiting} waiting`;
  }

  async function refresh() {
    error = '';
    try {
      const [healthRes, statusRes, probeRes, journalRes] = await Promise.all([
        fetch('/health'),
        fetch('/status'),
        fetch('/tools/probe'),
        fetch('/notes/stats'),
      ]);
      health = await healthRes.json().catch(() => null);
      status = statusRes.ok ? await statusRes.json() : null;
      probe = probeRes.ok || probeRes.status === 409 ? await probeRes.json() : null;
      journal = journalRes.ok ? await journalRes.json() : null;
    } catch (err) {
      error = err.message || String(err);
    }
  }

  async function runProbe(apply) {
    error = '';
    try {
      const response = await fetch('/tools/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      });
      probe = await response.json().catch(() => null);
      if (!response.ok && response.status !== 409) {
        error = probe?.error || `probe ${response.status}`;
      }
      await refresh();
    } catch (err) {
      error = err.message || String(err);
    }
  }

  function showUnreadable() {
    noteFilter = noteFilter === 'unreadable' ? 'all' : 'unreadable';
  }

  $: if (open) void refresh();

  onMount(() => {
    window.addEventListener('keydown', onKey);
    timer = setInterval(() => {
      if (open) void refresh();
    }, 4000);
    return () => window.removeEventListener('keydown', onKey);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

{#if open}
  <div class="dimmer" on:click={close} on:keydown={(event) => event.key === 'Enter' && close()} role="presentation"></div>
  <aside class="dw-card-elevated drawer" role="dialog" aria-labelledby="tools-title">
    <div class="drawer-head">
      <h2 id="tools-title">Tools</h2>
      <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={close}>Close</button>
    </div>

    {#if error}
      <p class="dw-error">{error}</p>
    {/if}

    <p class="dw-eyebrow">Queues</p>
    <p class="line">{queueLine('Transcription', health?.queues?.transcription)}</p>
    <p class="line">{queueLine('Cleanup', health?.queues?.processing)}</p>

    <p class="dw-eyebrow">Notes</p>
    <p class="line">
      {status
        ? `${status.done || 0} cleaned · ${status.rawOnly || 0} raw · ${status.pendingAudio || 0} pending · ${status.unreadable || 0} unreadable`
        : '…'}
    </p>
    <p class="dw-eyebrow">Index</p>
    <p class="line">
      {#if journal?.indexing}
        Indexing…
      {:else if journal}
        {journal.notes || 0} notes
        {#if journal.unreadable}
          · {journal.unreadable} unreadable
        {/if}
        {#if journal.embedded}
          · {journal.embedded} embedded{journal.embedModel ? ` (${journal.embedModel})` : ''}
        {:else}
          · FTS only
        {/if}
        {#if journal.lastRebuild}
          · rebuilt {String(journal.lastRebuild).slice(0, 16).replace('T', ' ')}
        {/if}
      {:else}
        …
      {/if}
    </p>
    <div class="row">
      <button
        type="button"
        class="dw-btn-secondary dw-btn-compact"
        class:is-on={noteFilter === 'unreadable'}
        on:click={showUnreadable}
      >
        Unreadable
      </button>
    </div>

    <p class="dw-eyebrow">Probe audio</p>
    <p class="line">
      {#if probe?.running}
        Scanning pending files…
      {:else if probe?.finishedAt}
        Last scan: {probe.bad} bad of {probe.pending} pending{probe.apply ? `, marked ${probe.marked}` : ''}.
      {:else}
        Find empty or broken files before Whisper spends time on them.
      {/if}
    </p>
    <div class="row">
      <button type="button" class="dw-btn-secondary dw-btn-compact" disabled={probe?.running} on:click={() => runProbe(false)}>
        Scan
      </button>
      <button type="button" class="dw-btn-secondary dw-btn-compact" disabled={probe?.running} on:click={() => runProbe(true)}>
        Mark bad
      </button>
    </div>
    {#if probe?.files?.length}
      <ul class="hits">
        {#each probe.files.slice(0, 20) as hit}
          <li><span class="reason">{hit.reason}</span> {hit.file.split(/[/\\]/).pop()}</li>
        {/each}
        {#if probe.files.length > 20}
          <li>+{probe.files.length - 20} more</li>
        {/if}
      </ul>
    {/if}

    <p class="dw-eyebrow">Checks</p>
    {#if health?.checks?.length}
      <ul class="checks">
        {#each health.checks as check}
          <li>
            <span class={pillClass(check.level)}>{check.id}</span>
            <span class="check-msg">{check.message}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="line">Health unavailable.</p>
    {/if}
  </aside>
{/if}

<style lang="scss">
  .dimmer {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 0.5);
  }

  .drawer {
    position: fixed;
    top: 0.75rem;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 50;
    width: min(24rem, calc(100vw - 1.5rem));
    overflow: auto;
    padding: 1.25rem;
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .dw-eyebrow {
    margin: 1rem 0 0.35rem;
  }

  .line {
    margin: 0 0 0.5rem;
    font-size: 0.875rem;
    line-height: 1.45;
    color: rgb(212 212 216);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
  }

  .is-on {
    border-color: rgb(245 158 11 / 0.45);
    color: rgb(253 230 138);
  }

  .hits,
  .checks {
    margin: 0 0 0.75rem;
    padding: 0;
    list-style: none;
  }

  .hits li,
  .checks li {
    margin: 0 0 0.4rem;
    font-size: 0.8rem;
    line-height: 1.4;
    color: rgb(161 161 170);
    overflow-wrap: anywhere;
  }

  .checks li {
    display: flex;
    gap: 0.45rem;
    align-items: flex-start;
  }

  .reason {
    display: block;
    color: rgb(252 165 165);
  }

  .check-msg {
    padding-top: 0.1rem;
  }
</style>
