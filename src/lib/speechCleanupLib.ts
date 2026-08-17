/** Collapse ASR stutter/hallucination loops for the cleanup prompt. Does not rewrite sidecar `text`. */
export function collapseSpeechLoops(text: string): string {
  const collapsed = String(text || '').replace(/\b(\w+)(?:[,.\s]+\1){2,}\b/gi, '$1');
  const lines = collapsed.split(/\r?\n/);
  const out: string[] = [];
  let prev = '';
  for (const line of lines) {
    const norm = line.trim().toLowerCase();
    if (norm && norm === prev) continue;
    out.push(line);
    if (norm) prev = norm;
  }
  return out.join('\n').replace(/[^\S\n]+/g, ' ').trim();
}
