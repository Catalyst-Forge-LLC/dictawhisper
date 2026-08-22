<script>
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  const dispatch = createEventDispatcher();

  let whisper = { label: 'Whisper', state: 'unknown', title: '' };
  let ollanet = { label: 'ollanet', state: 'unknown', title: '' };
  let device = { label: '…', state: 'unknown', title: '' };
  let timer;

  function pillClass(state) {
    if (state === 'fail') return 'dw-pill is-fail';
    if (state === 'warn') return 'dw-pill is-warn';
    return 'dw-pill';
  }

  async function loadHealth() {
    try {
      const response = await fetch('/health');
      const data = await response.json().catch(() => null);
      if (!data) return;

      const worker = data.whisperWorker || 'off';
      if (worker === 'ready') {
        whisper = { label: 'Whisper', state: 'ok', title: `ready · ${data.whisper || ''}` };
      } else if (worker === 'starting') {
        whisper = { label: 'Starting', state: 'warn', title: 'Whisper worker is starting' };
      } else {
        whisper = { label: 'Whisper', state: 'fail', title: `worker ${worker}` };
      }

      if (data.ollanet?.reachable) {
        ollanet = {
          label: 'ollanet',
          state: 'ok',
          title: data.ollanet.cleanModel || data.ollanet.machine || 'reachable',
        };
      } else if (data.ollanet?.machine || data.ollanet?.cleanModel) {
        ollanet = { label: 'ollanet', state: 'fail', title: 'unreachable' };
      } else {
        ollanet = { label: 'ollanet', state: 'warn', title: 'not configured' };
      }

      const kind = String(data.device || '').toLowerCase();
      device = {
        label: kind === 'cpu' ? 'CPU' : 'GPU',
        state: kind === 'cpu' ? 'warn' : 'ok',
        title: data.device || '',
      };
    } catch {
      whisper = { label: 'Whisper', state: 'fail', title: 'health unreachable' };
      ollanet = { label: 'ollanet', state: 'fail', title: 'health unreachable' };
      device = { label: '…', state: 'unknown', title: '' };
    }
  }

  onMount(() => {
    void loadHealth();
    timer = setInterval(() => void loadHealth(), 15_000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<header class="dw-header">
  <div class="dw-header-inner">
    <div class="brand">
      <span class="logo-wrap">
        <span class="logo-glow" aria-hidden="true"></span>
        <img src="/logo.png" alt="" width="36" height="36" />
      </span>
      <span class="wordmark">
        <span class="name">DictaWhisper</span>
        <span class="kicker">Local voice journal</span>
      </span>
    </div>
    <div class="tools">
      <div class="pills" aria-label="Health">
        <span class={pillClass(whisper.state)} title={whisper.title}>{whisper.label}</span>
        <span class={pillClass(ollanet.state)} title={ollanet.title}>{ollanet.label}</span>
        <span class={pillClass(device.state)} title={device.title}>{device.label}</span>
      </div>
      <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => dispatch('tools')}>
        Tools
      </button>
      <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => dispatch('help')}>
        Help
      </button>
    </div>
  </div>
</header>

<style lang="scss">
  .dw-header {
    z-index: 20;
    flex-shrink: 0;
    border-bottom: 1px solid rgb(255 255 255 / 0.07);
    backdrop-filter: blur(24px);
    background: linear-gradient(180deg, rgb(9 9 11 / 0.9) 0%, rgb(9 9 11 / 0.75) 100%);
  }

  .dw-header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    max-width: var(--dw-max);
    margin: 0 auto;
    padding: 0.5rem 0.85rem;
  }

  @media (min-width: 800px) {
    .dw-header-inner {
      padding: 0.6rem 1rem;
    }
  }

  .brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.65rem;
  }

  .logo-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .logo-glow {
    position: absolute;
    inset: -0.25rem;
    border-radius: 0.75rem;
    background: rgb(245 158 11 / 0.25);
    filter: blur(12px);
    opacity: 0.8;
  }

  .logo-wrap img {
    position: relative;
    display: block;
    width: 2rem;
    height: 2rem;
    object-fit: contain;
    border-radius: 0.6rem;
    box-shadow: 0 8px 16px rgb(0 0 0 / 0.6);
    outline: 1px solid rgb(255 255 255 / 0.15);
  }

  @media (min-width: 800px) {
    .logo-wrap img {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 0.75rem;
    }
  }

  .wordmark {
    display: flex;
    min-width: 0;
    flex-direction: column;
    line-height: 1.05;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: rgb(250 250 250);
  }

  .kicker {
    display: none;
    margin-top: 0.15rem;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgb(113 113 122);
  }

  @media (min-width: 640px) {
    .name {
      font-size: 1.125rem;
    }

    .kicker {
      display: block;
    }
  }

  .tools {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.5rem;
  }

  .pills {
    display: none;
    align-items: center;
    gap: 0.35rem;
  }

  @media (min-width: 640px) {
    .pills {
      display: flex;
    }
  }
</style>
