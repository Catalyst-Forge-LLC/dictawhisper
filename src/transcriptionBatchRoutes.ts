import type express from 'express';
import { getTranscriptionBatch, type TranscriptionBatchService } from './lib/transcriptionBatchLib.ts';

export function createTranscriptionBatchRoutes(getService: () => TranscriptionBatchService = getTranscriptionBatch) {
  return [
    { path: '/tools/transcription/batch', method: 'GET', handler: (req: express.Request, res: express.Response) => {
      try { res.setHeader('Cache-Control', 'no-store'); res.json(getService().snapshot(Number(req.query.offset) || 0, String(req.query.filter || 'all'))); }
      catch (error) { res.status(409).json({ error: String(error) }); }
    } },
    { path: '/tools/transcription/batch', method: 'POST', handler: async (req: express.Request, res: express.Response) => {
      try {
        const service = getService(), { action, id, policy, scope, candidateId, cleanup } = req.body || {};
        const result = action === 'preview' ? await service.preview(scope)
          : action === 'start' ? service.start(id, policy, cleanup === true)
          : action === 'stop' ? service.stop(id)
          : action === 'review_result' ? await service.reviewResult(id, candidateId)
          : action === 'resume' || action === 'retry_failed' ? service.resume(id, action === 'retry_failed') : null;
        if (!result) throw new Error('Choose preview, start, stop, resume or retry_failed.');
        res.status(action === 'preview' ? 200 : 202).json(result);
      } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
    } },
  ];
}
