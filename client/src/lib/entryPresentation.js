import { displayName } from './markPreview.js';
import { readableParagraphs } from '../../../src/shared/readableParagraphs.ts';

export function entryPresentation(entry, locale = 'en-US') {
  const json = entry?.transcriptionJson || {};
  const basename = displayName(entry?.jsonFile);
  const match = basename.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ _T]+(\d{2})[-:](\d{2})[-:](\d{2}))?/);
  let date = null, label = basename, precision = '', time = false;
  if (match) {
    const [, y, m, d, h, min, sec] = match;
    const candidate = new Date(Number(y), Number(m) - 1, Number(d || 1), Number(h || 0), Number(min || 0), Number(sec || 0));
    const valid = candidate.getFullYear() === Number(y) && candidate.getMonth() === Number(m) - 1 && candidate.getDate() === Number(d || 1) && (!h || (Number(h) < 24 && Number(min) < 60 && Number(sec) < 60));
    // A dangling numeric date/time component means parsing is uncertain.
    const rest = basename.slice(match[0].length);
    if (valid && !/^[-:]\d/.test(rest)) {
      date = candidate; precision = d ? 'day' : 'month'; time = Boolean(h);
      label = rest.replace(/^[ _-]+/, '').trim();
    }
  }
  const titleDate = date ? date.toLocaleDateString(locale, precision === 'month' ? { month: 'long', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const generic = /^(?:my\s+)?recording\s*(\d+)?$/i.exec(label);
  const title = String(json.displayTitle || '').trim() || (date && (!label || generic) ? `Recording on ${titleDate}` : label || basename || 'Untitled entry');
  let dateLabel = titleDate;
  if (time) dateLabel += ` · ${date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
  if (!dateLabel && entry?.day) dateLabel = `${entry.day} · inferred from file`;
  if(json.recordedDate){dateLabel=`${json.recordedDate} · ${json.recordedAtSource==='user'?'confirmed':'estimated'}`;precision='day';}
  return { title, dateLabel, precision, sequence: generic?.[1] || '', filename: basename, path: entry?.jsonFile || '' };
}

export { mayDoCounts } from '../../../src/shared/mayDoState.ts';
import { mayDoCounts } from '../../../src/shared/mayDoState.ts';

export function transcriptPassages(json, original = false) {
  if (original || !String(json?.cleanedTranscription || '').trim()) {
    if (json?.segments?.length) return json.segments;
    return String(json?.text || '').split(/\n{2,}/).filter(text => text.trim()).map(text => ({ text, start: null, end: null }));
  }
  if (json.playbackCues?.length) return json.playbackCues.flatMap(cue => {
    const paragraphs = readableParagraphs(cue.text);
    // The server regenerates word-aligned cues on entry load. For a legacy cue
    // without fresh timing, keep only its known start; never interpolate times.
    return paragraphs.map((text, index) => ({ ...cue, text, start: index === 0 ? cue.start : null, end: paragraphs.length === 1 ? cue.end : null }));
  });
  return readableParagraphs(json.cleanedTranscription).map(text => ({ text, start: null, end: null }));
}

/** Copy the displayed version's passages, not Whisper's flattened text field. */
export function transcriptCopyText(json, original = false) {
  const paragraphs = transcriptPassages(json, original)
    .map(row => String(row.text || '').trim()).filter(Boolean);
  return paragraphs.join('\n\n') || String((!original && json?.cleanedTranscription) || json?.text || '').trim();
}

export function activeMayDoCount(json) { return mayDoCounts(json).mayDoActiveCount; }

/** Literal in-entry highlighting; escape each piece before emitting markup. */
export function markEntryMatch(text, query) {
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const source = String(text || ''), term = String(query || '').trim();
  if (!term) return escape(source);
  let at = 0, next, html = '';
  while ((next = source.toLowerCase().indexOf(term.toLowerCase(), at)) >= 0) {
    html += escape(source.slice(at, next)) + '<mark>' + escape(source.slice(next, next + term.length)) + '</mark>';
    at = next + term.length;
  }
  return html + escape(source.slice(at));
}

export async function copyTranscriptText(text, clipboard) {
  try {
    if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
    await clipboard.writeText(text);
    return { error: '' };
  } catch {
    return { error: 'Could not copy. Select transcript text and copy manually.' };
  }
}
export function fileSizeLabel(bytes) {
  const size=Math.max(0,Number(bytes)||0);
  if(size<1024)return `${size} B`;
  if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;
  return `${(size/(1024*1024)).toFixed(1)} MB`;
}

/** Join checked passages in document order, without timestamps or UI highlighting. */
export function selectedPassageText(passages, selectedIndices) {
  const selected = new Set(selectedIndices);
  return passages.filter((_, index) => selected.has(index)).map(row => String(row.text || '').trim()).filter(Boolean).join('\n\n');
}
