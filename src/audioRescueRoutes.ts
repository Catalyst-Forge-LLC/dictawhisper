import type express from 'express';
import { audioRescue, type AudioRescueService } from './lib/audioRescueService.ts';
import { audioContentType } from './lib/audioLib.ts';

const failure = (res: express.Response, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(message.includes('outside configured watch roots') ? 403 : 409).json({ error: message });
};
export function createAudioRescueRoutes(service: AudioRescueService = audioRescue) { return [
  { path: '/notes/audio-improvement/summaries', method: 'POST', handler: (req: express.Request, res: express.Response) => {
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length > 100 || files.some(file => typeof file !== 'string' || file.length > 4096)) {
      res.status(400).json({ error: 'Choose up to 100 entry paths.' }); return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ items: [...new Set<string>(files)].map(file => {
      try { return { file, ...service.summary(file) }; }
      catch { return { file, error: 'Version status is unavailable.' }; }
    }) });
  } },
  { path: '/notes/audio-improvement', method: 'GET', handler: (req: express.Request, res: express.Response) => {
    try { res.json(service.status(String(req.query.file || ''), typeof req.query.id === 'string' ? req.query.id : undefined)); }
    catch (error) { failure(res, error); }
  } },
  { path: '/notes/audio-improvement/audio', method: 'GET', handler: (req: express.Request, res: express.Response) => {
    try {
      const audio = service.audio(String(req.query.file || ''), String(req.query.id || ''), String(req.query.variant || ''));
      res.setHeader('Content-Type', audioContentType(audio.path));
      res.setHeader('Cache-Control', 'private, no-store');
      res.sendFile(audio.relative, { root: audio.root, dotfiles: 'allow' });
    } catch (error) { failure(res, error); }
  } },
  ...['prepare', 'transcribe', 'apply', 'restore', 'discard'].map(action => ({
    path: `/notes/audio-improvement/${action}`, method: 'POST', handler: async (req: express.Request, res: express.Response) => {
      try {
        const file = String(req.body?.file || ''), id = String(req.body?.id || '');
        const result = action === 'prepare' ? service.prepare(file, req.body || {})
          : action === 'transcribe' ? service.transcribe(file, id)
          : action === 'apply' ? await service.apply(file, id, req.body?.reviewToken)
          : action === 'restore' ? await service.restore(file, id) : service.discard(file, id);
        res.status(['prepare', 'transcribe'].includes(action) ? 202 : 200).json(result);
      } catch (error) { failure(res, error); }
    },
  })),
]; }
export const audioRescueRoutes = createAudioRescueRoutes();
