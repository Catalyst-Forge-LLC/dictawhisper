export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

export type PlaybackCue = {
  start: number;
  end: number;
  text: string;
};

const FILLERS = new Set(['uh', 'um', 'umm', 'hmm', 'yeah', 'like']);

export function splitCleanedSections(cleaned: string): string[] {
  const trimmed = String(cleaned || '').trim();
  if (!trimmed) return [];
  const paras = trimmed.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paras.length >= 2) return paras;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length >= 2) return sentences;
  return [trimmed];
}

function words(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !FILLERS.has(word));
}

function overlap(sectionWords: string[], windowWords: string[]): number {
  if (!sectionWords.length || !windowWords.length) return 0;
  const counts = new Map<string, number>();
  for (const word of windowWords) counts.set(word, (counts.get(word) || 0) + 1);
  let hit = 0;
  for (const word of sectionWords) {
    const remaining = counts.get(word) || 0;
    if (remaining > 0) {
      hit += 1;
      counts.set(word, remaining - 1);
    }
  }
  return hit / sectionWords.length;
}

/** Map cleaned sections onto Whisper timestamps. Does not change the cleaned text. */
export function alignCleanedToSegments(cleaned: string, segments: WhisperSegment[]): PlaybackCue[] {
  const sections = splitCleanedSections(cleaned);
  const usable = (segments || []).filter(
    (segment) => typeof segment?.start === 'number' && typeof segment.text === 'string'
  );
  if (!sections.length || !usable.length) return [];

  let cursor = 0;
  const cues: PlaybackCue[] = [];

  for (const text of sections) {
    const sectionWords = words(text);
    let bestIdx = cursor;
    let bestScore = -1;
    const searchEnd = Math.min(usable.length, cursor + Math.max(12, Math.ceil(sectionWords.length / 2) + 4));

    for (let i = cursor; i < searchEnd; i += 1) {
      const windowWords: string[] = [];
      const windowLimit = Math.min(usable.length, i + 8);
      for (let j = i; j < windowLimit; j += 1) windowWords.push(...words(usable[j].text));
      const score = sectionWords.length ? overlap(sectionWords, windowWords) : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    let endIdx = bestIdx;
    if (sectionWords.length) {
      const gathered: string[] = [];
      for (let i = bestIdx; i < usable.length; i += 1) {
        gathered.push(...words(usable[i].text));
        endIdx = i;
        if (overlap(sectionWords, gathered) >= 0.85 || gathered.length >= sectionWords.length * 1.4) break;
        if (i - bestIdx > 20) break;
      }
    }

    cues.push({
      start: Number(usable[bestIdx].start) || 0,
      end: Number(usable[endIdx].end) || Number(usable[bestIdx].end) || 0,
      text,
    });
    cursor = Math.min(endIdx + 1, usable.length - 1);
  }

  for (let i = 1; i < cues.length; i += 1) {
    if (cues[i].start < cues[i - 1].start) cues[i].start = cues[i - 1].start;
    if (cues[i].end < cues[i].start) cues[i].end = cues[i].start;
  }
  return cues;
}

export function ensurePlaybackCues(json: {
  cleanedTranscription?: string;
  segments?: WhisperSegment[];
  playbackCues?: PlaybackCue[];
}): boolean {
  const cleaned = json?.cleanedTranscription;
  const segments = json?.segments;
  if (!cleaned || !Array.isArray(segments) || !segments.length) return false;

  const sections = splitCleanedSections(cleaned);
  const existing = json.playbackCues;
  if (
    Array.isArray(existing) &&
    existing.length === sections.length &&
    existing.every((cue) => typeof cue?.start === 'number' && typeof cue.text === 'string')
  ) {
    return false;
  }

  json.playbackCues = alignCleanedToSegments(cleaned, segments);
  return true;
}
