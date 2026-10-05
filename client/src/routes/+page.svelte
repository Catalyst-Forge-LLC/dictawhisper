<script>
  import io from 'socket.io-client';
  import AppHeader from '../lib/components/AppHeader.svelte';
  import CollapsibleAside from '../lib/components/CollapsibleAside.svelte';
  import ToolsAside from '../lib/components/ToolsAside.svelte';
  import Transcriptions from '../lib/components/Transcriptions.svelte';

  const socket = io({ path: '/socket.io' });
  let helpOpen = false;
  let toolsOpen = false;
  let noteFilter = 'all';
</script>

<div class="dw-app-shell">
  <AppHeader
    on:help={() => {
      helpOpen = !helpOpen;
      if (helpOpen) toolsOpen = false;
    }}
    on:tools={() => {
      toolsOpen = !toolsOpen;
      if (toolsOpen) helpOpen = false;
    }}
  />
  <main class="dw-main">
    <Transcriptions {socket} bind:noteFilter />
  </main>
  <CollapsibleAside bind:open={helpOpen} />
  <ToolsAside bind:open={toolsOpen} bind:noteFilter />
</div>
