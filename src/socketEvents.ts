import { saveAudioFile } from './lib/audioLib.ts';
import { Socket } from 'socket.io';
import { emitNotesIndex, process } from './lib/transcriptionLib.ts';
import { resolveAllowedPath } from './lib/pathAllowLib.ts';

export function socketConnect(socket: Socket, transcriptions: Record<string, any>) {
  console.log(
    `[socket-connection] A user connected (${Object.keys(transcriptions).length} sidecars cached).`,
  );
  try {
    emitNotesIndex(socket);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[socket-connection] notes-index emit failed: ${detail}`);
  }
}

export const socketEvents = [
  {
    event: 'disconnect',
    handler: () => {
      console.log('[socket-disconnect] A user disconnected');
    },
  },
  {
    event: 'new-message',
    handler: (msg: any) => {
      if (msg.audioDataURL) {
        console.log('[socket-new-message] Message: Audio File', String(msg.audioDataURL).substr(0, 500));
        const filePath = saveAudioFile(msg.audioDataURL, msg.clipName);
        void process(filePath, { force: true });
      }
    },
  },
  {
    event: 'force-transcribe',
    handler: (msg: any) => {
      if (!msg?.file) return;
      const allowed = resolveAllowedPath(msg.file);
      if (!allowed.ok) {
        console.warn(`[socket-force-transcribe] rejected: ${allowed.error} (${msg.file})`);
        return;
      }
      console.log(`[socket-force-transcribe] Retrying transcription: ${allowed.path}`);
      void process(allowed.path, { retry: true });
    },
  },
  {
    event: 'delete-transcription',
    handler: () => { console.warn('[socket-delete-transcription] Deprecated. Use acknowledged POST /notes/trash/remove. No files were removed.'); },
  },
];
