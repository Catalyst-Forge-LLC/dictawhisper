import fs from 'fs';
import { audioExtensions, saveAudioFile } from './lib/audioLib.ts';
import { Socket } from 'socket.io';
import { emitTranscription, process } from './lib/transcriptionLib.ts';

export function socketConnect(ioSocket: Socket, transcriptions: Record<string, any>) {
  console.log(`[socket-connection] A user connected, emitting ${Object.keys(transcriptions).length} transcriptions.`);
  Object.entries(transcriptions).forEach(([file]) => {
    emitTranscription(ioSocket, file, null);
  });
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
        saveAudioFile(msg.audioDataURL, msg.clipName);
      }
    },
  },
  {
    event: 'force-transcribe',
    handler: (msg: any) => {
      if (msg?.file) {
        console.log(`[socket-force-transcribe] Forcing transcription: ${msg.file}`);
        void process(msg.file, null, { force: true });
      }
    },
  },
  {
    event: 'delete-transcription',
    handler: (msg: any) => {
      if (msg.jsonFile && fs.existsSync(msg.jsonFile)) {
        console.log(`[socket-delete-transcription] Deleting transcription file: ${msg.jsonFile}`);
        fs.unlinkSync(msg.jsonFile);
        audioExtensions.forEach((ext) => {
          const audioFile = msg.jsonFile.replace(/\.json$/, `.${ext}`);
          if (fs.existsSync(audioFile)) {
            console.log(`[socket-delete-transcription] Deleting associated audio file: ${audioFile}`);
            fs.unlinkSync(audioFile);
          }
        });
      }
    },
  },
];
