import { writable } from 'svelte/store';

// Virtualized cards register only while mounted. One bounded metadata request
// serves the list and reader; no candidate text or whole-library polling.
export function createAudioReviewMonitor(request = async files => {
  const response = await fetch('/notes/audio-improvement/summaries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }), cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Version status is unavailable.');
  return (await response.json()).items;
}) {
  const state = writable({}), mounted = new Map();
  let timer, interval, generation = 0, inFlight = false, again = false;
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 80); }
  async function refresh() {
    if (!mounted.size || typeof document !== 'undefined' && document.hidden) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    const revision = generation, files = [...mounted.keys()];
    try {
      for (let offset = 0; offset < files.length; offset += 100) {
        const batch = files.slice(offset, offset + 100);
        let items;
        try { items = await request(batch); }
        catch { items = batch.map(file => ({ file, error: 'Version status is unavailable.' })); }
        if (revision !== generation) break;
        state.update(current => {
          const next = { ...current };
          for (const item of items) if (mounted.has(item.file)) next[item.file] = item.error ? { ...next[item.file], error: item.error } : item;
          return next;
        });
      }
    } finally { inFlight = false; if (again) { again = false; schedule(); } }
  }
  function watch(file) {
    mounted.set(file, (mounted.get(file) || 0) + 1);
    if (!interval) {
      interval = setInterval(refresh, 10_000);
      globalThis.document?.addEventListener('visibilitychange', schedule);
      globalThis.window?.addEventListener('focus', schedule);
    }
    schedule();
    return () => {
      const count = mounted.get(file) - 1;
      if (count) mounted.set(file, count); else {
        mounted.delete(file);
        state.update(current => { const next = { ...current }; delete next[file]; return next; });
      }
      if (!mounted.size) {
        generation++; clearTimeout(timer); clearInterval(interval); interval = null;
        globalThis.document?.removeEventListener('visibilitychange', schedule);
        globalThis.window?.removeEventListener('focus', schedule);
      }
    };
  }
  return { subscribe: state.subscribe, watch, refresh };
}
export const audioReviews = createAudioReviewMonitor();
