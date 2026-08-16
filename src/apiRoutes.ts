import express from 'express';
import { process, cleanTranscription, countStatus } from './lib/transcriptionLib.ts';
import { q } from './lib/queueLib.ts';
import { config } from './config.ts';
import { resolveWhisperModel } from './lib/whisperLib.ts';

export const apiRoutes = [
  {
    path: '/',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      res.send('<h1>DictaWhisper</h1><p>Watch, transcribe, clean.</p>');
    },
  },
  {
    path: '/health',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      res.json({
        ok: true,
        whisper: resolveWhisperModel(),
        ollanet: config.ollanet,
        settleMinutes: config.watch.settleMinutes,
        queues: {
          transcription: q['transcription'] ? { length: q['transcription'].length(), running: q['transcription'].running() } : null,
          processing: q['processing'] ? { length: q['processing'].length(), running: q['processing'].running() } : null,
        },
      });
    },
  },
  {
    path: '/status',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      res.json(countStatus([...config.watch.roots, config.watch.browserDropFolder]));
    },
  },
  {
    path: '/transcribe/force',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const file = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
      if (!file) {
        res.status(400).json({ error: 'POST { "file": "C:\\\\path\\\\to\\\\note.mp3" }' });
        return;
      }
      process(file, null, { force: true });
      res.json({ ok: true, file, forced: true });
    },
  },
  {
    path: '/process/force',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const file = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
      if (!file) {
        res.status(400).json({ error: 'POST { "file": "C:\\\\path\\\\to\\\\note.mp3" }' });
        return;
      }
      cleanTranscription(file, (err) => {
        if (err) {
          res.status(500).json({ ok: false, error: err.message });
          return;
        }
        res.json({ ok: true, file, processed: true });
      });
    },
  },
];
