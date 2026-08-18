<script>
  import io from 'socket.io-client';
  import AppHeader from '../lib/components/AppHeader.svelte';
  import AudioRecorder from '../lib/components/AudioRecorder.svelte';
  import CollapsibleAside from '../lib/components/CollapsibleAside.svelte';
  import Transcriptions from '../lib/components/Transcriptions.svelte';

  const socket = io({ path: '/socket.io' });
  let helpOpen = false;
</script>

<div class="dw-app-shell">
  <AppHeader on:help={() => (helpOpen = !helpOpen)} />
  <main class="dw-main">
    <AudioRecorder />
    <Transcriptions {socket} />
  </main>
  <CollapsibleAside bind:open={helpOpen} />
</div>
