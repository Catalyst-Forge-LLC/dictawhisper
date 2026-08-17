import { Server as SocketIOServer } from 'socket.io';
import fs from 'fs';
import http from 'http';
import express from 'express';
import { config } from './config.ts';
import { apiRoutes } from './apiRoutes.ts';
import { socketConnect, socketEvents } from './socketEvents.ts';
import {
  cleanTranscription,
  initTranscriptionWatcher,
  loadExistingTranscriptions,
  setTranscriptionIo,
  transcriptions,
} from './lib/transcriptionLib.ts';
import { initVoiceRootPipeline } from './lib/organizationLib.ts';
import { formatDuration, logSettleConfig } from './lib/fileSettleLib.ts';
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

setTranscriptionIo(io);

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

io.on('connection', (socket) => {
  socketConnect(socket, transcriptions);
  for (const { event, handler } of socketEvents) {
    socket.on(event, handler);
  }
});

async function main() {
  console.log(`[dictawhisper] whisper=${resolveWhisperModel()} device=${config.whisper.device}`);
  console.log(`[dictawhisper] ollanet ${config.ollanet.machine || '(unset)'} / ${config.ollanet.cleanModel || '(unset)'}`);
  logSettleConfig('voice-settle');
  console.log(
    `[voice-settle] browser-drop files ${
      config.watch.browserSettleMs === 0
        ? 'immediately (settle disabled)'
        : `${formatDuration(config.watch.browserSettleMs)} after last write`
    }`
  );

  fs.mkdirSync(config.watch.browserDropFolder, { recursive: true });
  loadExistingTranscriptions([...config.watch.roots, config.watch.browserDropFolder]);

  initTranscriptionWatcher(config.watch.browserDropFolder, {
    watchDepth: 2,
    settleMs: config.watch.browserSettleMs,
  });
  initVoiceRootPipeline(config.watch.roots);

  server.listen(config.http.port, config.http.host, () => {
    console.log(`listening on ${config.http.host}:${config.http.port}`);
  });
}

main();
