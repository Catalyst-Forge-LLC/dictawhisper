import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import express from 'express';
import type { Socket } from 'socket.io';
import { config } from './config.ts';
import { apiRoutes } from './apiRoutes.ts';
import { socketConnect, socketEvents } from './socketEvents.ts';
import {
  cleanTranscription,
  initTranscriptionForSourceFolders,
  initTranscriptionWatcher,
  setTranscriptionSocket,
  transcriptions,
} from './lib/transcriptionLib.ts';
import { watchAndOrganizeAudioFiles } from './lib/organizationLib.ts';
import { logSettleConfig } from './lib/fileSettleLib.ts';
import { resolveWhisperModel, whisperTranscribe } from './lib/whisperLib.ts';
import { initQueues } from './lib/queueLib.ts';
import { cleanAudioFile } from './lib/audioLib.ts';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  cors: {
    origin: config.http.corsOrigins,
    methods: ['GET', 'POST'],
  },
});

let ioSocket: Socket | null = null;

initQueues({
  transcription: {
    processor: async (task, callback) => {
      console.log(`[queue-transcription] Cleaning file: ${task.file}`);
      const fileCleaned = config.audio.preprocess ? await cleanAudioFile(task.file, false) : false;
      console.log(
        `[queue-transcription] Transcribing file: ${task.file} -> ${task.transcriptionFile}, fileCleaned: ${fileCleaned}`
      );
      await whisperTranscribe(task.file, task.transcriptionFile, callback as any);
    },
    concurrency: config.queues.transcription.concurrency,
    active: config.queues.transcription.active,
  },
  processing: {
    processor: (task, callback) => {
      console.log(`[queue-processing] Processing file: ${task.file}`);
      cleanTranscription(task.file, callback);
    },
    concurrency: config.queues.processing.concurrency,
    active: config.queues.processing.active,
  },
});

for (const route of apiRoutes) {
  if (route.method === 'GET') app.get(route.path, route.handler);
  else if (route.method === 'POST') app.post(route.path, route.handler);
  else throw new Error(`Unsupported method: ${route.method}`);
}

io.on('connection', async (socket) => {
  ioSocket = socket;
  setTranscriptionSocket(socket);
  socketConnect(ioSocket, transcriptions);
  for (const { event, handler } of socketEvents) {
    socket.on(event, handler);
  }
});

async function main() {
  console.log(`[dictawhisper] whisper=${resolveWhisperModel()} device=${config.whisper.device}`);
  console.log(`[dictawhisper] ollanet ${config.ollanet.machine} / ${config.ollanet.cleanModel}`);
  logSettleConfig('voice-settle');

  initTranscriptionWatcher(config.watch.browserDropFolder, ioSocket);
  watchAndOrganizeAudioFiles(config.watch.roots);
  initTranscriptionForSourceFolders(config.watch.roots, ioSocket);

  server.listen(config.http.port, () => {
    console.log(`listening on *:${config.http.port}`);
  });
}

main();
