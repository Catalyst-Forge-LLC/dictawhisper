export const CLEAN_PROMPT_VERSION = 2;

export type MayDoStatus = 'suggested' | 'selected' | 'done' | 'dismissed';
export type MayDo = {
  id: string;
  title: string;
  verb: string;
  sourceQuote: string;
  start: number | null;
  end: number | null;
  status: MayDoStatus;
  createdAt: string;
  updatedAt: string;
};
export type MayDoExtraction = { version: number; sourceHash: string; createdAt: string; model?: string; host?: string };

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

/** How one cleanup pass was produced. Current text is also in `cleanedTranscription`. */
export type CleanupRecord = {
  text: string;
  createdAt?: string;
  model?: string;
  host?: string;
  promptVersion?: number;
  dictawhisperVersion?: string;
};

/** Sidecar JSON next to a recording. Disk is the source of truth. */
export type TranscriptionDocument = {
  entryId?: string;
  recordedDate?: string;
  recordedAt?: string;
  recordedAtSource?: string;
  originalFilename?: string;
  displayTitle?: string;
  tagsEditedAt?: string;
  text?: string;
  cleanedTranscription?: string;
  tags?: string[];
  mayDos?: MayDo[];
  mayDoExtraction?: MayDoExtraction;
  mayDoError?: string;
  segments?: WhisperSegment[];
  language?: string;
  elapsed?: string;
  thinking?: string;
  meta?: Record<string, unknown>;
  whisper?: Record<string, unknown>;
  playbackCues?: PlaybackCue[];
  playbackCuesSource?: string;
  cleanup?: CleanupRecord;
  cleanupHistory?: CleanupRecord[];
  cleanupError?: string;
  cleanupAttempts?: number;
  cleanupSkipped?: boolean;
  /** ffmpeg/preprocess could not read the audio. Do not retry until force. */
  audioError?: string;
  starred?: boolean;
  promptVersion?: number;
};
