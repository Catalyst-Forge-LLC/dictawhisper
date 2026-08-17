<script>
  import { onMount } from 'svelte';

  let canvas;
  let canvasCtx;
  let audioCtx;
  let mainSection;
  let fileInput;
  let mediaRecorder = null;
  let chunks = [];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function getFilenameDate() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  }

  onMount(() => {
    const record = document.querySelector('.record');
    const stop = document.querySelector('.stop');
    canvas = document.querySelector('.visualizer');
    mainSection = document.querySelector('.main-controls');
    canvasCtx = canvas.getContext('2d');
    stop.disabled = true;

    window.onresize = function () {
      canvas.width = mainSection.offsetWidth;
    };
    window.onresize();

    record.onclick = async function () {
      try {
        if (!mediaRecorder) {
          await armRecorder();
        }
        chunks = [];
        mediaRecorder.start();
        record.style.background = 'red';
        stop.disabled = false;
        record.disabled = true;
      } catch (err) {
        console.log('The following error occured: ' + err);
        alert('Microphone access is required to record.');
      }
    };

    stop.onclick = function () {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
      mediaRecorder.stop();
      record.style.background = '';
      record.style.color = '';
      stop.disabled = true;
      record.disabled = false;
    };
  });

  async function armRecorder() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia not supported');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    visualize(stream);
    mediaRecorder.onstop = function () {
      const clipName = `voice-recording_${getFilenameDate()}`;
      uploadAudioFile(new Blob(chunks, { type: 'audio/webm; codecs=opus' }), 'blob', clipName);
      chunks = [];
    };
    mediaRecorder.ondataavailable = function (e) {
      chunks.push(e.data);
    };
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
    event.preventDefault(); // Prevent default behavior to allow drop.
  }

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer.files;
    uploadAudioFiles(files, 'file');
  }

  function handleFileUpload(event) {
    console.log('handleFileUpload', { event });
    const files = event.target.files;
    uploadAudioFiles(files, 'file');
  }

  function uploadAudioFile(file, type, clipName = null) {
    if (clipName === null) {
      clipName = `${file.name.split('.').slice(0, -1).join('.')}_${getFilenameDate()}`;
    }

    const clipContainer = document.createElement('article');
    const clipLabel = document.createElement('p');
    const audio = document.createElement('audio');
    const deleteButton = document.createElement('button');

    clipContainer.classList.add('clip');
    audio.setAttribute('controls', '');
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'delete';

    clipLabel.textContent = clipName;

    clipContainer.appendChild(audio);
    clipContainer.appendChild(clipLabel);
    clipContainer.appendChild(deleteButton);
    document.querySelector('.sound-clips').appendChild(clipContainer);
    audio.controls = true;

    if (type === 'file') {
      const reader = new FileReader();
      reader.onload = () => {
        audio.src = reader.result;
      };
      reader.readAsDataURL(file);
    } else {
      audio.src = window.URL.createObjectURL(file);
    }

    void postAudio(file, clipName).catch((error) => {
      alert(error.message || String(error));
    });

    deleteButton.onclick = function (e) {
      e.target.closest('.clip').remove();
    };

    clipLabel.onclick = function () {
      const existingName = clipLabel.textContent;
      const newClipName = prompt('Enter a new name for your sound clip?', existingName);
      if (newClipName !== null) {
        clipLabel.textContent = newClipName;
      }
    };
  }

  function uploadAudioFiles(files, type = 'file') {
    if (!files.length) return;

    Array.from(files).forEach((file) => {
      if (file.type.startsWith('audio/')) {
        uploadAudioFile(file, type);
      } else {
        alert('Unsupported file type. Please upload an audio file.');
      }
    });
  }

  function visualize(stream) {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }

    const source = audioCtx.createMediaStreamSource(stream);

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);
    //analyser.connect(audioCtx.destination);

    draw();

    function draw() {
      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;

      requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = 'rgb(200, 200, 200)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = 'rgb(0, 0, 0)';

      canvasCtx.beginPath();

      let sliceWidth = (WIDTH * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        let v = dataArray[i] / 128.0;
        let y = (v * HEIGHT) / 2;

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    }
  }
</script>

<section class="main-controls" on:dragover={handleDragOver} on:drop={handleDrop}>
  <canvas class="visualizer" height="60px"></canvas>
  <div id="buttons">
    <button class="record">Record</button>
    <button class="stop">Stop</button>
  </div>
  <input class="button" type="file" accept="audio/*" multiple bind:this={fileInput} on:change={handleFileUpload} />
  <p class="drop-hint">Drag and drop audio files here, or use the buttons above.</p>
</section>

<section class="sound-clips"></section>

<style lang="scss">
  .main-controls {
    padding: 0.5rem 0;
  }

  canvas {
    display: block;
    margin-bottom: 0.5rem;
  }

  #buttons {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  button,
  .button {
    font-size: 1rem;
    padding: 1rem;
    width: calc(50% - 0.25rem);
  }

  /* Make the clips use as much space as possible, and
   * also show a scrollbar when there are too many clips to show
   * in the available space */
  .sound-clips {
    overflow: auto;
  }

  .clip {
    padding-bottom: 1rem;
  }

  audio {
    width: 100%;
    display: block;
    margin: 1rem auto 0.5rem;
  }

  .clip p {
    display: inline-block;
    font-size: 1rem;
    cursor: pointer;
  }

  .clip button {
    font-size: 1rem;
    float: right;
  }

  button.delete {
    background: #f00;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }
</style>
