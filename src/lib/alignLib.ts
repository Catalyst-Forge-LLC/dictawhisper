export type WhisperWord = {
  word: string;
  start: number;
  end: number;
};

export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
};

export type PlaybackCue = {
  start: number | null;
  end: number | null;
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

function normWord(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function contentWords(text: string): string[] {
  return String(text || '')
    .split(/\s+/)
    .map(normWord)
    .filter((word) => word.length > 1 && !FILLERS.has(word));
}

export function flattenSegmentWords(segments: WhisperSegment[] | undefined): WhisperWord[] {
  const out: WhisperWord[] = [];
  for (const segment of segments || []) {
    if (!Array.isArray(segment.words)) continue;
    for (const word of segment.words) {
      if (typeof word?.start !== 'number' || typeof word.end !== 'number') continue;
      if (!String(word.word || '').trim()) continue;
      out.push({ word: word.word, start: word.start, end: word.end });
    }
  }
  return out;
}

type Token = WhisperWord & { key: string };

function tokenizeWords(words: WhisperWord[]): Token[] {
  return words
    .map((word) => ({ ...word, key: normWord(word.word) }))
    .filter((word) => word.key.length > 1 && !FILLERS.has(word.key));
}

/** Map cleaned sections onto Whisper word timestamps. Sequential; does not invent times. */
export function alignCleanedToWords(cleaned: string, words: WhisperWord[]): PlaybackCue[] {
  const sections = splitCleanedSections(cleaned);
  const tokens = tokenizeWords(words);
  if (!sections.length || !tokens.length) return [];

  let cursor = 0;
  const cues: PlaybackCue[] = [];

  for (const text of sections) {
    const needed = contentWords(text);
    if (!needed.length) {
      const at = tokens[Math.min(cursor, tokens.length - 1)];
      cues.push({ start: at.start, end: at.end, text });
      continue;
    }

    const searchEnd = Math.min(tokens.length, cursor + Math.max(30, needed.length * 4));
    let startIdx = -1;
    for (let i = cursor; i < searchEnd; i += 1) {
      if (tokens[i].key === needed[0]) {
        startIdx = i;
        break;
      }
    }
    if (startIdx < 0) {
      cues.push({ start: null, end: null, text });
      continue;
    }

    let wordIdx = startIdx;
    let needIdx = 0;
    let endIdx = startIdx;
    while (wordIdx < tokens.length && needIdx < needed.length) {
      if (tokens[wordIdx].key === needed[needIdx]) {
        endIdx = wordIdx;
        wordIdx += 1;
        needIdx += 1;
        continue;
      }
      const upcoming = tokens.slice(wordIdx + 1, wordIdx + 4).some((token) => token.key === needed[needIdx]);
      if (upcoming) wordIdx += 1;
      else needIdx += 1;
    }

    cues.push({
      start: tokens[startIdx].start,
      end: tokens[endIdx].end,
      text,
    });
    cursor = endIdx + 1;
  }

  return cues;
}

export function ensurePlaybackCues(json: {
  cleanedTranscription?: string;
  segments?: WhisperSegment[];
  playbackCues?: PlaybackCue[];
  playbackCuesSource?: string;
}): boolean {
  const cleaned = json?.cleanedTranscription;
  const words = flattenSegmentWords(json?.segments);
  const sections = cleaned ? splitCleanedSections(cleaned) : [];

  if (words.length && cleaned && sections.length) {
    const existing = json.playbackCues;
    if (
      json.playbackCuesSource === 'words' &&
      Array.isArray(existing) &&
      existing.length === sections.length &&
      existing.every((cue) => cue && typeof cue.text === 'string')
    ) {
      return false;
    }
    json.playbackCues = alignCleanedToWords(cleaned, words);
    json.playbackCuesSource = 'words';
    return true;
  }

  if (json.playbackCues || json.playbackCuesSource) {
    delete json.playbackCues;
    delete json.playbackCuesSource;
    return true;
  }
  return false;
}
