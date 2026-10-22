const labels = {
  uncertain: 'Uncertain speech', uncovered_audio: 'Audio without text',
  repetition: 'Repeated wording', empty: 'No timed speech', timing: 'Timing to check', audio: 'Audio note',
};

export function reviewClock(value) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// Match the bounded context used by alternate ASR passes. Never invent a time
// for recording-wide warnings or feed untrusted sidecar timestamps to a player.
export function transcriptionReview(quality, segments = []) {
  const passages = [], notes = [];
  const duration = Number.isFinite(quality?.preparation?.durationSec) ? quality.preparation.durationSec : Infinity;
  for (const [id, issue] of (Array.isArray(quality?.issues) ? quality.issues : []).entries()) {
    if (!issue || typeof issue !== 'object') continue;
    const label = labels[issue.kind] || 'Passage to check';
    if (!Number.isFinite(issue.start) || !Number.isFinite(issue.end) || issue.start < 0 || issue.end <= issue.start || issue.start >= duration) {
      const message = String(issue.message || label);
      const existing = notes.find(note => note.message === message);
      if (existing) existing.count++; else notes.push({message, count: 1});
      continue;
    }
    const start = Math.max(0, issue.start - 2);
    const end = Math.min(duration, start + 45, issue.end + 2);
    const text = (Array.isArray(segments) ? segments : []).filter(segment =>
      Number.isFinite(segment?.start) && Number.isFinite(segment?.end) && segment.end > start && segment.start < end
    ).map(segment => String(segment.text || '').trim()).filter(Boolean).join(' ');
    passages.push({id, issue, label, start, end, text, truncated: end < Math.min(duration, issue.end)});
  }
  passages.sort((a, b) => a.issue.start - b.issue.start || a.id - b.id);
  return {passages, notes};
}

// Own only an explicitly requested review clip. Detach on navigation, source
// changes or manual seeking elsewhere so normal playback is never capped later.
export function createReviewPlayback(update) {
  let active = null;
  function release(pause = false, error = '') {
    const session = active;
    active = null;
    if (session) {
      clearTimeout(session.timer);
      for (const [name, handler] of Object.entries(session.events)) session.player.removeEventListener(name, handler);
      if (pause) session.player.pause();
    }
    update({playing: false, error});
  }
  function play(player, cue) {
    release(true);
    if (!player || !Number.isFinite(cue?.start) || !Number.isFinite(cue?.end) || cue.start < 0 || cue.end <= cue.start) {
      release(false, 'This passage has no playable audio range.'); return;
    }
    player.pause();
    const session = {player, start: cue.start, end: cue.end, events: {}, timer: null, started: false};
    active = session;
    const fail = () => { if (active === session) release(true, 'Audio could not play. Try again or use the audio player above.'); };
    const begin = async () => {
      if (active !== session || session.started) return;
      session.started = true;
      session.end = Math.min(cue.end, Number.isFinite(player.duration) ? player.duration : cue.end);
      if (session.start >= session.end) { fail(); return; }
      try {
        player.currentTime = session.start;
        await player.play();
        if (active === session) clearTimeout(session.timer);
      } catch { fail(); }
    };
    session.events = {
      loadedmetadata: begin,
      timeupdate: () => { if (!player.seeking && player.currentTime >= session.end) release(true); },
      seeked: () => { if (player.currentTime < session.start || player.currentTime > session.end) release(); },
      pause: () => { if (player.paused) release(); }, ended: () => release(), error: fail, emptied: () => release(true),
    };
    for (const [name, handler] of Object.entries(session.events)) player.addEventListener(name, handler);
    session.timer = setTimeout(fail, 10000);
    update({playing: true, error: ''});
    if (player.readyState >= 1) void begin();
    // Metadata loading belongs to the parent. Do not reset its saved position.
  }
  return {play, stop: () => release(true)};
}
