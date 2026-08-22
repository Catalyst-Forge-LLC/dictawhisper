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
  emitNotesIndex,
  loadExistingTranscriptions,
  recordAudioFailure,
  setTranscriptionIo,
  transcriptions,
} from './lib/transcriptionLib.ts';
import { initVoiceRootPipeline } from './lib/organizationLib.ts';
import { closeAllWatchers } from './classes/Watcher.ts';
import { formatDuration, logSettleConfig } from './lib/fileSettleLib.ts';
import { startWhisperWorker, stopWhisperWorker, whisperTranscribe } from './lib/whisperLib.ts';
import { initQueues } from './lib/queueLib.ts';
import { cleanAudioFile, probeAudioFile } from './lib/audioLib.ts';
import { collectHealth, printHealthReport } from './lib/healthLib.ts';
import { initJournalIndex, startJournalIndex } from './lib/journalService.ts';
import {
  apiListenHost,
  discoverTailscale,
  inboxUrls,
  resolvedCorsOrigins,
} from './lib/tailscaleLib.ts';

const tailscaleSelf = config.http.tailscale ? discoverTailscale() : null;
const corsOrigins = resolvedCorsOrigins(config, tailscaleSelf);
const listenHost = apiListenHost(config);

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // Inbox index is ~10MB with a full VoiceNotes tree; 1MB dropped the packet.
  maxHttpBufferSize: 32e6,
  pingTimeout: 60000,
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
  },
});

setTranscriptionIo(io);

function startQueues(): void {
  initQueues({
    transcription: {
      processor: async (task, callback) => {
        try {
          const probe = probeAudioFile(task.file);
          if (!probe.ok) {
            throw new Error(`unreadable audio: ${probe.reason}`);
          }
          console.log(`[queue-transcription] Cleaning file: ${task.file}`);
          let working = task.file;
          if (config.audio.preprocess) {
            working = await cleanAudioFile(task.file, false);
          }
          console.log(
            `[queue-transcription] Transcribing file: ${working} -> ${task.transcriptionFile}`
          );
          await whisperTranscribe(working, task.transcriptionFile, callback as any);
        } catch (error) {
          console.error(
            `[queue-transcription] skip unreadable audio ${task.file}:`,
            error instanceof Error ? error.message : error,
          );
          recordAudioFailure(task.transcriptionFile, error);
          callback(error instanceof Error ? error : new Error(String(error)));
        }
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
}

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

function listen(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(error);
    });
    server.listen(config.http.port, listenHost, () => {
      console.log(`listening on ${listenHost}:${config.http.port}`);
      if (config.http.tailscale) {
        if (tailscaleSelf) {
          console.log(
            `[tailscale] inbox ${inboxUrls(config, tailscaleSelf)
              .filter((url) => !url.includes('127.0.0.1') && !url.includes('localhost'))
              .join('  ')}`
          );
        } else {
          console.warn(
            '[tailscale] enabled but `tailscale` CLI did not return an IP — inbox stays on 127.0.0.1:7777'
          );
        }
      }
      resolve();
    });
  });
}

async function main() {
  console.log('[health] probing (python / CUDA / ffmpeg / ollanet); UI can connect once the port is up');
  try {
    await listen();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[health] FAIL  port ${listenHost}:${config.http.port} ${detail}`);
    process.exit(1);
  }

  fs.mkdirSync(config.watch.browserDropFolder, { recursive: true });
  initJournalIndex();
  loadExistingTranscriptions([...config.watch.roots, config.watch.browserDropFolder]);
  emitNotesIndex();
  const journalRoots = [...config.watch.roots, config.watch.browserDropFolder];
  void startJournalIndex(journalRoots).then(() => emitNotesIndex());

  const report = await collectHealth(config, { mode: 'startup' });
  printHealthReport(report, 'health');
  if (!report.ok) {
    console.error('[health] startup checks failed; inbox will still serve notes already on disk');
  }

  startQueues();
  logSettleConfig('voice-settle');
  console.log(
    `[voice-settle] browser-drop files ${
      config.watch.browserSettleMs === 0
        ? 'immediately (settle disabled)'
        : `${formatDuration(config.watch.browserSettleMs)} after last write`
    }`
  );

  initTranscriptionWatcher(config.watch.browserDropFolder, {
    watchDepth: 2,
    settleMs: config.watch.browserSettleMs,
  });
  initVoiceRootPipeline(config.watch.roots);

  void startWhisperWorker().catch((error: Error) => {
    console.warn(`[whisper] worker did not start (${error.message}); one-shot fallback until it recovers`);
  });
}

function shutdown(code = 0) {
  void closeAllWatchers()
    .catch((error) => console.warn(`[shutdown] watchers: ${error}`))
    .then(() => stopWhisperWorker())
    .finally(() => {
      server.close(() => process.exit(code));
      setTimeout(() => process.exit(code), 4000).unref();
    });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main();
