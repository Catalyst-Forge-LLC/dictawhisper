export function microphoneFailure(error, secure = true) {
  if (!secure) return 'Recording needs a secure page (HTTPS or localhost). Import audio instead.';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return 'Microphone permission was denied. Allow it in browser settings and try again, or import audio.';
  if (error?.name === 'NotFoundError') return 'No microphone was found. Connect an input and try again, or import audio.';
  if (error?.name === 'NotReadableError') return 'The microphone is unavailable or in use. Release it in the other app and try again, or import audio.';
  return error?.message || 'Recording is unavailable in this browser. Import audio instead.';
}

/** Media lifecycle never implies Save. Inject adapters to exercise denial/stop/teardown without hardware. */
export function createCaptureSession({ media, Recorder, onChange = () => {}, now = Date.now, secure = true } = {}) {
  let recorder, stream, chunks = [], destroyed = false, intent = '', openedAt = 0, generation=0;
  let state = { phase: 'idle', draft: null, error: '', elapsed: 0 };
  function update(patch) { state = { ...state, ...patch }; onChange(state); }
  function release() { stream?.getTracks().forEach(track => track.stop()); stream = null; }
  return {
    get state() { return state; },
    get stream() { return stream; },
    tick() { if (state.phase === 'recording') update({ elapsed: now() - openedAt }); },
    async start() {
      if (destroyed || ['requesting', 'recording', 'stopping', 'uploading'].includes(state.phase) || state.draft) return;
      update({ phase: 'requesting', error: '' });
      const request=++generation;
      try {
        if (!secure) throw new Error('Insecure context');
        if (!media?.getUserMedia || !Recorder) throw new Error('This browser does not support microphone recording. Import audio instead.');
        const granted = await media.getUserMedia({ audio: true });
        if (destroyed || request!==generation) { granted.getTracks().forEach(track=>track.stop()); return; }
        stream=granted;
        recorder = new Recorder(stream); chunks = []; intent = '';
        recorder.ondataavailable = event => { if (!destroyed && request===generation && event.data?.size) chunks.push(event.data); };
        recorder.onstop = () => {
          if (request!==generation) return;
          release();
          if (destroyed || intent !== 'draft') { chunks = []; return; }
          const draft = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); chunks = [];
          update({ phase: 'draft', draft, elapsed: now() - openedAt, error: draft.size ? '' : 'No audio was captured. Discard and try again.' });
        };
        recorder.onerror = event => { if(request!==generation)return; intent = 'discard'; release(); update({ phase: 'idle', error: microphoneFailure(event.error, secure) }); };
        recorder.start(); openedAt = now(); update({ phase: 'recording', elapsed: 0 });
      } catch (error) { if(request!==generation)return; release(); if (!destroyed) update({ phase: 'idle', error: microphoneFailure(error, secure) }); }
    },
    stop() { if (state.phase !== 'recording') return; intent = 'draft'; update({ phase: 'stopping' }); recorder.stop(); },
    discard() { if (state.phase === 'uploading') return; generation++; intent = 'discard'; if (recorder?.state === 'recording') recorder.stop(); release(); chunks = []; update({ phase: 'idle', draft: null, error: '', elapsed: 0 }); },
    async save(upload) {
      if (!state.draft || state.phase === 'uploading') return;
      const draft = state.draft; update({ phase: 'uploading', error: '' });
      try { const result = await upload(draft); if (!result?.saved || !result?.file) throw new Error('The server did not acknowledge saved audio. Check Activity before retrying.'); update({ phase: 'accepted', draft: null, accepted: result }); return result; }
      catch (error) { update({ phase: 'draft', draft, error: error.message || String(error) }); }
    },
    destroy() { destroyed = true; intent = 'discard'; if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; if (recorder.state === 'recording') recorder.stop(); } release(); chunks = []; },
  };
}

export function validateImport(file, capabilities) {
  if (!capabilities) return 'Checking supported formats; try again shortly.';
  if (!file.size) return 'This file is empty.';
  if (file.size > capabilities.maxBytes) return `Exceeds ${Math.round(capabilities.maxBytes / 1024 / 1024)} MiB.`;
  const extension = String(file.name).split('.').pop().toLowerCase();
  if (!capabilities.formats.includes(extension) && !String(file.type).startsWith('audio/')) return 'Unsupported format. Choose audio from the supported formats.';
  return '';
}

/** Per-row state with a hard two-request limit; failed rows retain their source for explicit retry. */
export function createImportQueue({ upload, capabilities, onChange = () => {}, id = () => crypto.randomUUID() }) {
  let rows = []; let active = 0; let disposed = false;
  const publish = () => onChange([...rows]);
  async function pump() {
    if (disposed) return;
    for (const row of rows) {
      if (active >= 2) return;
      if (row.state !== 'preparing') continue;
      active++; row.state = 'uploading'; publish();
      Promise.resolve().then(() => upload(row.file, row.id)).then(result => {
        if (!result?.saved || !result?.file) throw new Error('No saved acknowledgment received. Check Activity before retrying.');
        row.state = 'saved'; row.result = result; row.file = null; row.error = '';
      }).catch(error => { row.state = 'failed'; row.error = error.message || String(error); }).finally(() => { active--; publish(); void pump(); });
    }
  }
  return {
    add(files) { for (const file of files) { const error = validateImport(file, capabilities()); rows.push({ id: id(), file, name: file.name, size: file.size, state: error ? 'failed' : 'preparing', error }); } publish(); void pump(); },
    retry(identity) { const row = rows.find(row => row.id === identity); if (!row || row.state !== 'failed' || !row.file) return; const error = validateImport(row.file, capabilities()); row.error = error; if (!error) row.state = 'preparing'; publish(); void pump(); },
    remove(identity) { rows = rows.filter(row => row.id !== identity || row.state === 'uploading'); publish(); },
    get unsaved() { return rows.some(row => row.file && row.state !== 'saved'); },
    destroy() { disposed = true; },
  };
}
