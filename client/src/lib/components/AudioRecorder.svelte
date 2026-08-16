<script>
  import { onMount } from 'svelte';

  let canvas;
  let canvasCtx;
  let audioCtx;
  let mainSection;
  let fileInput;

  export let socket;

  onMount(() => {
    setup();
    window.onresize = function () {
      canvas.width = mainSection.offsetWidth;
    };

    window.onresize();
  });

  function getFilenameDate() {
    return new Date()
      .toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      .replaceAll('/', '-')
      .replaceAll(':', '-')
      .replace(', ', '_');
  }

  //**dataURL to blob**
  function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','),
      mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]),
      n = bstr.length,
      u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  //**blob to dataURL**
  function blobToDataURL(blob, callback) {
    var a = new FileReader();
    a.onload = function (e) {
      callback(e.target.result);
    };
    a.readAsDataURL(blob);
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
        socket.emit('new-message', { audioDataURL: reader.result, clipName });
      };
      reader.readAsDataURL(file);
    } else if (type === 'blob') {
      const audioURL = window.URL.createObjectURL(file);
      audio.src = audioURL;
      blobToDataURL(file, (audioDataURL) => {
        socket.emit('new-message', { audioDataURL, clipName });
      });
    }

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

  function setup() {
    // set up basic variables for app

    const record = document.querySelector('.record');
    const stop = document.querySelector('.stop');
    const soundClips = document.querySelector('.sound-clips');
    canvas = document.querySelector('.visualizer');
    mainSection = document.querySelector('.main-controls');

    // disable stop button while not recording

    stop.disabled = true;

    // visualizer setup - create web audio api context and canvas

    canvasCtx = canvas.getContext('2d');

    //main block for doing the audio recording

    if (navigator.mediaDevices.getUserMedia) {
      console.log('getUserMedia supported.');

      const constraints = { audio: true };
      let chunks = [];

      let onSuccess = function (stream) {
        const mediaRecorder = new MediaRecorder(stream);

        visualize(stream);

        record.onclick = function () {
          mediaRecorder.start();
          console.log(mediaRecorder.state);
          console.log('recorder started');
          record.style.background = 'red';

          stop.disabled = false;
          record.disabled = true;
        };

        stop.onclick = function () {
          mediaRecorder.stop();
          console.log(mediaRecorder.state);
          console.log('recorder stopped');
          record.style.background = '';
          record.style.color = '';
          // mediaRecorder.requestData();

          stop.disabled = true;
          record.disabled = false;
        };

        mediaRecorder.onstop = function (e) {
          console.log('data available after MediaRecorder.stop() called.');

          const clipName = `voice-recording_${getFilenameDate()}`;
          uploadAudioFile(new Blob(chunks, { type: 'audio/ogg; codecs=opus' }), 'blob', clipName);

          chunks = [];
        };

        mediaRecorder.ondataavailable = function (e) {
          chunks.push(e.data);
        };
      };

      let onError = function (err) {
        console.log('The following error occured: ' + err);
      };

      navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
    } else {
      console.log('getUserMedia not supported on your browser!');
    }
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
