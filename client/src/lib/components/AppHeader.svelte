<script>
  import AppIcon from './AppIcon.svelte';
  import AudioRecorder from './AudioRecorder.svelte';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  export let navigationOpen = false;

  export let connected = false;
  export let workingCount = 0;
  export let failureCount = 0;
</script>

<header class="dw-header">
  <div class="dw-header-inner">
    <div class="brand">
      <button class="dw-btn-secondary dw-btn-compact" aria-expanded={navigationOpen} aria-controls="library-navigation" on:click={() => dispatch("navigation")}><AppIcon name="library" size={16}/>Library</button>
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
      <AudioRecorder {connected} on:accepted on:openentry on:activity />
      <button class="dw-btn-secondary dw-btn-compact" on:click={() => dispatch('activity')} aria-label={`Activity${workingCount ? ', ' + workingCount + ' in progress' : ''}${failureCount ? ', ' + failureCount + ' need attention' : ''}`}><AppIcon name="activity" size={16}/><span>Activity</span>{#if failureCount}<span class="activity-count dw-tone-danger" aria-hidden="true">{failureCount}</span>{:else if workingCount}<span class="activity-count dw-tone-info" aria-hidden="true">{workingCount}</span>{/if}</button>
      <button type="button" class="dw-btn-secondary dw-btn-compact" data-settings-trigger on:click={() => dispatch('tools')}>
        <AppIcon name="settings" size={16}/>Settings
      </button>
      <button type="button" class="dw-btn-secondary dw-btn-compact header-help" data-help-trigger on:click={() => dispatch('help')}>
        <AppIcon name="help" size={16}/>Help
      </button>
    </div>
  </div>
</header>

<style lang="scss">
  .activity-count{border-radius:5px;min-width:18px;padding:1px 4px;font-size:11px;font-variant-numeric:tabular-nums;} .tools>button{position:relative;} @media(max-width:599px){.activity-count{position:absolute;right:3px;top:2px;}}

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
    padding: 6px 12px;
    flex-wrap: wrap;
  }

  @media (min-width: 800px) {
    .dw-header-inner {
      padding: 6px 12px;
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

  @media (max-width: 599px) {
    .header-help, .logo-wrap { display:none; }
    .wordmark { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .dw-header-inner { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 4px; padding: 5px 8px; }
    .brand { display: block; }
    .tools { display: contents; }
    .brand button, .tools :global(.dw-btn-compact) { width: 100%; min-height: 48px; flex-direction: column; padding: 4px 2px; gap: 3px; font-size: 11px; }
  }
</style>
