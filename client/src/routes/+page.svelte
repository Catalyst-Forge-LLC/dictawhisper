<script>
  import io from 'socket.io-client';
  import AudioRecorder from '../lib/components/AudioRecorder.svelte';
  import CollapsibleAside from '../lib/components/CollapsibleAside.svelte';
  import Transcriptions from '../lib/components/Transcriptions.svelte';

  const socket = io({ path: '/socket.io' });
</script>

<div class="wrapper">
  <header class="masthead">
    <img src="/logo.png" alt="" width="64" height="64" />
    <h1>DictaWhisper</h1>
  </header>

  <AudioRecorder />

  <Transcriptions {socket} />

  <CollapsibleAside />
</div>
