export const CLEAN_PROMPT_VERSION = 1;

export type WhisperWord = {
  word: string;
  start: number;
  end: number;
  probability?: number | null;
};

export type WhisperSegment = {
  id?: number;
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

/** Sidecar JSON next to a recording. Disk is the source of truth. */
export type TranscriptionDocument = {
  text?: string;
  cleanedTranscription?: string;
  tags?: string[];
  segments?: WhisperSegment[];
  language?: string;
  elapsed?: string;
  thinking?: string;
  meta?: Record<string, unknown>;
  whisper?: Record<string, unknown>;
  playbackCues?: PlaybackCue[];
  playbackCuesSource?: string;
  cleanupError?: string;
  cleanupAttempts?: number;
  cleanupSkipped?: boolean;
  promptVersion?: number;
};
