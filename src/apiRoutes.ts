import path from 'path';
import express from 'express';
import { process, cleanTranscription, countStatus, listNoteSummaries, readTranscription } from './lib/transcriptionLib.ts';
import { q } from './lib/queueLib.ts';
import { config } from './config.ts';
import { resolveWhisperModel } from './lib/whisperLib.ts';
import { resolveAllowedPath } from './lib/pathAllowLib.ts';
import { audioContentType, findAudioForSidecar } from './lib/audioLib.ts';
import { applyConsolidateGroups, buildConsolidatePlan } from './lib/tagConsolidateLib.ts';

function requireAllowedFile(req: express.Request, res: express.Response): string | null {
  const file = typeof req.body?.file === 'string' ? req.body.file.trim() : '';
  if (!file) {
    res.status(400).json({ error: 'POST { "file": "<path under a watch root>" }' });
    return null;
  }
  const allowed = resolveAllowedPath(file);
  if (!allowed.ok) {
    res.status(403).json({ error: allowed.error });
    return null;
  }
  return allowed.path;
}

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
        host: config.http.host,
        port: config.http.port,
        whisper: resolveWhisperModel(),
        ollanet: config.ollanet,
        settleMinutes: config.watch.settleMinutes,
        browserSettleMs: config.watch.browserSettleMs,
        queues: {
          transcription: q['transcription']
            ? { length: q['transcription'].length(), running: q['transcription'].running() }
            : null,
          processing: q['processing']
            ? { length: q['processing'].length(), running: q['processing'].running() }
            : null,
        },
      });
    },
  },
  {
    path: '/audio',
    method: 'GET',
    handler: (req: express.Request, res: express.Response) => {
      const file = typeof req.query.file === 'string' ? req.query.file.trim() : '';
      if (!file) {
        res.status(400).json({ error: 'GET /audio?file=<path under a watch root>' });
        return;
      }
      const allowed = resolveAllowedPath(file);
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.error });
        return;
      }
      let audioPath = allowed.path;
      if (audioPath.toLowerCase().endsWith('.json')) {
        const sibling = findAudioForSidecar(audioPath);
        if (!sibling) {
          res.status(404).json({ error: 'no audio file next to that sidecar' });
          return;
        }
        audioPath = sibling;
      }
      const audioAllowed = resolveAllowedPath(audioPath);
      if (!audioAllowed.ok) {
        res.status(403).json({ error: audioAllowed.error });
        return;
      }
      res.setHeader('Content-Type', audioContentType(audioAllowed.path));
      res.sendFile(path.resolve(audioAllowed.path));
    },
  },
  {
    path: '/notes/index',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      res.json({ notes: listNoteSummaries() });
    },
  },
  {
    path: '/note',
    method: 'GET',
    handler: (req: express.Request, res: express.Response) => {
      const file = typeof req.query.file === 'string' ? req.query.file.trim() : '';
      if (!file) {
        res.status(400).json({ error: 'GET /note?file=<sidecar path under a watch root>' });
        return;
      }
      const allowed = resolveAllowedPath(file);
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.error });
        return;
      }
      try {
        const note = readTranscription(allowed.path);
        if (!note) {
          res.status(404).json({ error: 'note not found' });
          return;
        }
        res.json(note);
      } catch (error: any) {
        res.status(500).json({ error: error?.message || 'failed to read note' });
      }
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
      const file = requireAllowedFile(req, res);
      if (!file) return;
      process(file, { retry: true });
      res.json({ ok: true, file, retried: true });
    },
  },
  {
    path: '/process/force',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const file = requireAllowedFile(req, res);
      if (!file) return;
      cleanTranscription(file, (err) => {
        if (err) {
          res.status(500).json({ ok: false, error: err.message });
          return;
        }
        res.json({ ok: true, file, processed: true });
      });
    },
  },
  {
    path: '/tags/consolidate/preview',
    method: 'POST',
    handler: async (req: express.Request, res: express.Response) => {
      try {
        const useModel = req.body?.useModel !== false;
        const plan = await buildConsolidatePlan({ useModel });
        res.json(plan);
      } catch (error: any) {
        res.status(500).json({ error: error?.message || 'tag preview failed' });
      }
    },
  },
  {
    path: '/tags/consolidate/apply',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const groups = Array.isArray(req.body?.groups) ? req.body.groups : null;
      if (!groups) {
        res.status(400).json({ error: 'POST { "groups": [{ "keep": "tag", "drop": ["alias"] }] }' });
        return;
      }
      const cleaned: { keep: string; drop: string[] }[] = [];
      for (const group of groups) {
        const keep = typeof group?.keep === 'string' ? group.keep.trim() : '';
        const drop = Array.isArray(group?.drop)
          ? group.drop.map((tag: unknown) => String(tag || '').trim()).filter(Boolean)
          : [];
        if (!keep || !drop.length) continue;
        cleaned.push({ keep, drop });
      }
      if (!cleaned.length) {
        res.status(400).json({ error: 'no merge groups to apply' });
        return;
      }
      try {
        res.json(applyConsolidateGroups(cleaned));
      } catch (error: any) {
        res.status(500).json({ error: error?.message || 'tag apply failed' });
      }
    },
  },
];
