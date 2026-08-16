<script>
  import io from 'socket.io-client';
  import { onMount } from 'svelte';
  import AudioRecorder from '../lib/components/AudioRecorder.svelte';
  import CollapsibleAside from '../lib/components/CollapsibleAside.svelte';
  import Transcriptions from '../lib/components/Transcriptions.svelte';
  const socket = io('localhost:8008');

  onMount(() => {});
</script>

<div class="wrapper">
  <header>
    <h1>DictaWhisper</h1>
  </header>

  <AudioRecorder {socket} />

  <Transcriptions {socket} />

  <CollapsibleAside />
</div>
