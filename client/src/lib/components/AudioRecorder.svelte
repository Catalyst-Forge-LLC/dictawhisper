<script>
  import { onDestroy, onMount } from 'svelte';

  let canvas;
  let well;
  let fileInput;
  let canvasCtx;
  let audioCtx;
  let mediaRecorder = null;
  let chunks = [];
  let recording = false;
  let captureOpen = false;
  let arming = false;
  let dragOver = false;
  let error = '';
  let status = '';
  let drawId = 0;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function getFilenameDate() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  }

  function sizeCanvas() {
    if (!canvas || !well) return;
    canvas.width = well.clientWidth;
    canvas.height = 60;
    paintIdle();
  }

  function paintIdle() {
    if (!canvasCtx || !canvas) return;
    canvasCtx.fillStyle = 'rgb(0 0 0 / 0.35)';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  }

  onMount(() => {
    canvasCtx = canvas.getContext('2d');
    sizeCanvas();
    const observer = new ResizeObserver(() => sizeCanvas());
    if (well) observer.observe(well);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    if (drawId) cancelAnimationFrame(drawId);
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
    void audioCtx?.close();
  });

  async function armRecorder() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia not supported');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.onstop = function () {
      const clipName = `voice-recording_${getFilenameDate()}`;
      void uploadAudioFile(new Blob(chunks, { type: 'audio/webm; codecs=opus' }), clipName);
      chunks = [];
    };
    mediaRecorder.ondataavailable = function (e) {
      chunks.push(e.data);
    };
    visualize(stream);
  }

  async function startRecord() {
    error = '';
    captureOpen = true;
    arming = true;
    try {
      if (!mediaRecorder) await armRecorder();
      chunks = [];
      mediaRecorder.start();
      recording = true;
    } catch (err) {
      error = 'Microphone access is required to record.';
      console.log('The following error occured: ' + err);
    } finally {
      arming = false;
    }
  }

  function stopRecord() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    recording = false;
    paintIdle();
  }

  async function postAudio(blobOrFile, clipName) {
    const form = new FormData();
    const filename = blobOrFile.name || `${clipName}.webm`;
    form.append('file', blobOrFile, filename);
    form.append('clipName', clipName);
    const response = await fetch('/audio', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `upload failed (${response.status})`);
    return data;
  }

  function handleDragOver(event) {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    dragOver = true;
    captureOpen = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(event) {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    dragOver = false;
    uploadAudioFiles(event.dataTransfer.files);
  }

  function handleFileUpload(event) {
    uploadAudioFiles(event.target.files);
    event.target.value = '';
  }

  async function uploadAudioFile(file, clipName = null) {
    captureOpen = true;
    if (clipName === null) {
      clipName = `${file.name.split('.').slice(0, -1).join('.')}_${getFilenameDate()}`;
    }
    status = `Sending ${clipName}…`;
    try {
      await postAudio(file, clipName);
      status = '';
    } catch (err) {
      error = err.message || String(err);
      status = '';
    }
  }

  function uploadAudioFiles(files) {
    if (!files?.length) return;
    error = '';
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('audio/')) {
        void uploadAudioFile(file);
      } else {
        error = 'Unsupported file type. Please upload an audio file.';
      }
    });
  }

  function visualize(stream) {
    if (!audioCtx) audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);

    function draw() {
      drawId = requestAnimationFrame(draw);
      if (!canvasCtx || !canvas) return;
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;
      canvasCtx.fillStyle = 'rgb(0 0 0 / 0.35)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);
      if (!recording) {
        canvasCtx.strokeStyle = 'rgb(251 191 36 / 0.25)';
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, HEIGHT / 2);
        canvasCtx.lineTo(WIDTH, HEIGHT / 2);
        canvasCtx.stroke();
        return;
      }
      analyser.getByteTimeDomainData(dataArray);
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = '#fcd34d';
      canvasCtx.beginPath();
      const sliceWidth = WIDTH / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * HEIGHT) / 2;
        if (i === 0) canvasCtx.moveTo(x, y);
        else canvasCtx.lineTo(x, y);
        x += sliceWidth;
      }
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    }

    draw();
  }
</script>

<svelte:window on:dragover={handleDragOver} on:drop={handleDrop} on:keydown={(event) => {
  if (event.key === 'Escape' && !recording && !arming) captureOpen = false;
}} />

<section class="capture" aria-label="Record or import audio">
  <div class="row">
    <button type="button" class="dw-btn-primary dw-btn-compact" aria-expanded={captureOpen} aria-controls="audio-capture" on:click={() => (captureOpen = !captureOpen)}>{recording ? 'Recording…' : 'Record'}</button>
    <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => fileInput?.click()}>Import</button>
  </div>
  <div
  id="audio-capture"
  role="region"
  aria-label="Audio capture"
  class="capture-panel dw-card-elevated"
  class:is-visible={captureOpen || recording}
  class:is-drop={dragOver}
  on:dragleave={handleDragLeave}
>
  <div class="well" class:is-visible={captureOpen || dragOver || recording} bind:this={well}>
    <canvas class="visualizer" bind:this={canvas} height="60"></canvas>
  </div>
  <div class="row">
    <button
      type="button"
      class="dw-btn-primary dw-btn-compact"
      class:is-recording={recording}
      disabled={recording || arming}
      on:click={startRecord}
    >
      {recording ? 'Recording…' : arming ? 'Opening microphone…' : 'Start recording'}
    </button>
    {#if recording}
      <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={stopRecord}>Stop & save</button>
    {/if}
    <button type="button" class="dw-btn-secondary dw-btn-compact" on:click={() => fileInput?.click()}>
      Import
    </button>
    <input
      bind:this={fileInput}
      class="file"
      type="file"
      accept="audio/*"
      multiple
      on:change={handleFileUpload}
    />
  </div>
  {#if captureOpen || dragOver || recording}
    <p class="hint">Drag audio here to import.</p>
    <button type="button" class="dw-text-btn" disabled={recording || arming} on:click={() => (captureOpen = false)}>Close recorder</button>
  {/if}
  {#if status}
    <p class="dw-muted">{status}</p>
  {/if}
  {#if error}
    <p class="dw-error">{error}</p>
  {/if}
  </div>
</section>

<style lang="scss">
  .capture {
    position: static;
  }

  .capture-panel {
    display: none;
    position: absolute;
    right: 1rem;
    top: calc(100% + 0.5rem);
    width: min(28rem, calc(100vw - 2rem));
    padding: 0.85rem;
    background: rgb(18 18 21 / 0.98);
  }

  .capture-panel.is-visible { display: block; }

  .capture-panel.is-drop {
    border-color: rgb(251 191 36 / 0.45);
    box-shadow: 0 0 0 3px rgb(251 191 36 / 0.14);
  }

  .well {
    overflow: hidden;
    border-radius: 0.75rem;
    border: 1px solid rgb(255 255 255 / 0.08);
    background: rgb(0 0 0 / 0.35);
    height: 0;
    visibility: hidden;
  }

  .well.is-visible {
    height: 60px;
    visibility: visible;
  }

  canvas {
    display: block;
    width: 100%;
    height: 60px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0;
  }

  .capture-panel .row {
    margin-top: 0.75rem;
  }

  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  .hint {
    margin-top: 0.6rem;
    font-size: 0.75rem;
    color: rgb(113 113 122);
  }

  .dw-error,
  .dw-muted {
    margin-top: 0.6rem;
  }
</style>
