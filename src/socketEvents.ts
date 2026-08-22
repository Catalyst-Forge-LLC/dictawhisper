import fs from 'fs';
import { audioExtensions, saveAudioFile } from './lib/audioLib.ts';
import { Socket } from 'socket.io';
import { emitNotesIndex, forgetTranscription, process } from './lib/transcriptionLib.ts';
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
    handler: (msg: any) => {
      if (!msg.jsonFile) return;
      const allowed = resolveAllowedPath(msg.jsonFile);
      if (!allowed.ok) {
        console.warn(`[socket-delete-transcription] rejected: ${allowed.error} (${msg.jsonFile})`);
        return;
      }
      if (!fs.existsSync(allowed.path)) return;
      console.log(`[socket-delete-transcription] Deleting transcription file: ${allowed.path}`);
      fs.unlinkSync(allowed.path);
      forgetTranscription(allowed.path);
      audioExtensions.forEach((ext) => {
        const audioFile = allowed.path.replace(/\.json$/i, `.${ext}`);
        const audioAllowed = resolveAllowedPath(audioFile);
        if (audioAllowed.ok && fs.existsSync(audioAllowed.path)) {
          console.log(`[socket-delete-transcription] Deleting associated audio file: ${audioAllowed.path}`);
          fs.unlinkSync(audioAllowed.path);
        }
      });
    },
  },
];
