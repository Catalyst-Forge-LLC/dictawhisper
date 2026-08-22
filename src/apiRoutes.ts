import path from 'path';
import express from 'express';
import multer from 'multer';
import { process, cleanTranscription, countStatus, getTranscriptionFilename, listNoteSummaries, patchTranscription, readTranscription, skipCleanup, emitNotesIndex } from './lib/transcriptionLib.ts';
import {
  journalStats,
  journalTags,
  journalYears,
  listInboxNotes,
  notesIndexPayload,
  searchJournalIndex,
} from './lib/journalService.ts';
import type { SearchMode, SearchSort } from './lib/journalIndexLib.ts';
import { q } from './lib/queueLib.ts';
import { config } from './config.ts';
import { resolveWhisperModel } from './lib/whisperLib.ts';
import { getHealthReport } from './lib/healthLib.ts';
import { resolveAllowedPath } from './lib/pathAllowLib.ts';
import { audioContentType, findAudioForSidecar, saveUploadedAudio } from './lib/audioLib.ts';
import { applyConsolidateGroups, buildConsolidatePlan } from './lib/tagConsolidateLib.ts';
import { resolveHeldFile, type HoldingAction } from './lib/organizationLib.ts';
import { getProbeJob, startProbeJob } from './lib/audioProbeLib.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function queryList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => queryList(item));
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function queryFlag(value: unknown): boolean {
  return value === '1' || value === 'true' || value === true;
}

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
    handler: async (req: express.Request, res: express.Response) => {
      const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
      const report = await getHealthReport(config, { mode: 'live', fresh });
      res.status(report.ok ? 200 : 503).json({
        ok: report.ok,
        degraded: report.degraded,
        host: config.http.host,
        port: config.http.port,
        whisper: resolveWhisperModel(),
        whisperWorker: report.whisper.worker,
        device: report.whisper.device,
        ollanet: {
          ...config.ollanet,
          reachable: report.ollanet.reachable,
        },
        settleMinutes: config.watch.settleMinutes,
        browserSettleMs: config.watch.browserSettleMs,
        checks: report.checks,
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
    handler: (req: express.Request, res: express.Response) => {
      try {
        const year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
        const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
        const unreadable = queryFlag(req.query.unreadable);
        const starred = queryFlag(req.query.starred);
        const all = queryFlag(req.query.all);
        if (year || month || unreadable || starred || all) {
          res.json({
            notes: listInboxNotes({
              year: year || undefined,
              month: month || undefined,
              unreadable: unreadable || undefined,
              starred: starred || undefined,
              all: all || undefined,
            }),
            paged: !all,
            indexing: journalStats().indexing,
          });
          return;
        }
        res.json(notesIndexPayload(listNoteSummaries));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[notes-index] failed: ${detail}`);
        res.status(500).json({ error: 'failed to build notes index' });
      }
    },
  },
  {
    path: '/notes/search',
    method: 'GET',
    handler: async (req: express.Request, res: express.Response) => {
      try {
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const tags = queryList(req.query.tag);
        const since = typeof req.query.since === 'string' ? req.query.since.trim() : '';
        const until = typeof req.query.until === 'string' ? req.query.until.trim() : '';
        const modeRaw = typeof req.query.mode === 'string' ? req.query.mode.trim() : '';
        const mode = modeRaw === 'lex' || modeRaw === 'semantic' || modeRaw === 'hybrid' ? (modeRaw as SearchMode) : undefined;
        const sortRaw = typeof req.query.sort === 'string' ? req.query.sort.trim() : '';
        const sort = sortRaw === 'recent' || sortRaw === 'oldest' || sortRaw === 'relevance' ? (sortRaw as SearchSort) : undefined;
        const year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
        const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
        const limit = Number(req.query.limit);
        const hits = await searchJournalIndex({
          query,
          tags,
          since: since || undefined,
          until: until || undefined,
          year: year || undefined,
          month: month || undefined,
          mode,
          sort,
          limit: Number.isFinite(limit) ? limit : undefined,
          unreadable: queryFlag(req.query.unreadable),
          starred: queryFlag(req.query.starred),
        });
        res.json({ hits, count: hits.length });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[notes-search] failed: ${detail}`);
        res.status(500).json({ error: 'search failed' });
      }
    },
  },
  {
    path: '/notes/years',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      try {
        res.json({ years: journalYears() });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: detail });
      }
    },
  },
  {
    path: '/notes/tags',
    method: 'GET',
    handler: (req: express.Request, res: express.Response) => {
      try {
        res.json({
          tags: journalTags({
            includeSingletons: queryFlag(req.query.includeSingletons),
            limit: Number(req.query.limit) || undefined,
          }),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: detail });
      }
    },
  },
  {
    path: '/notes/stats',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      try {
        res.json(journalStats());
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: detail });
      }
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
    path: '/note',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const file = requireAllowedFile(req, res);
      if (!file) return;
      const jsonFile = file.toLowerCase().endsWith('.json') ? file : getTranscriptionFilename(file);
      const allowed = resolveAllowedPath(jsonFile);
      if (!allowed.ok) {
        res.status(403).json({ error: allowed.error });
        return;
      }
      if (req.body?.tags === undefined && typeof req.body?.starred !== 'boolean') {
        res.status(400).json({ error: 'POST { "file", "tags"?: string[], "starred"?: boolean }' });
        return;
      }
      try {
        res.json(
          patchTranscription(allowed.path, {
            tags: req.body?.tags,
            starred: typeof req.body?.starred === 'boolean' ? req.body.starred : undefined,
          }),
        );
      } catch (error: any) {
        const status = String(error?.message || '').includes('not found') ? 404 : 500;
        res.status(status).json({ error: error?.message || 'failed to update note' });
      }
    },
  },
  {
    path: '/tools/probe',
    method: 'GET',
    handler: (_req: express.Request, res: express.Response) => {
      res.json(getProbeJob());
    },
  },
  {
    path: '/tools/probe',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const apply = Boolean(req.body?.apply);
      const current = getProbeJob();
      if (current.running) {
        res.status(409).json(current);
        return;
      }
      const started = startProbeJob([...config.watch.roots, config.watch.browserDropFolder], { apply });
      res.status(202).json(started);
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
      }, { reclean: true });
    },
  },
  {
    path: '/process/skip',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const file = requireAllowedFile(req, res);
      if (!file) return;
      try {
        skipCleanup(file);
        res.json({ ok: true, file, skipped: true });
      } catch (error: any) {
        res.status(500).json({ error: error?.message || 'skip failed' });
      }
    },
  },
  {
    path: '/audio',
    method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      upload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'audio', maxCount: 1 },
      ])(req, res, (err: unknown) => {
        if (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'upload failed' });
          return;
        }
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const uploaded = files?.file?.[0] || files?.audio?.[0];
        if (!uploaded?.buffer) {
          res.status(400).json({ error: 'POST multipart field "file" (or "audio")' });
          return;
        }
        const clipName = typeof req.body?.clipName === 'string' ? req.body.clipName.trim() : '';
        const saved = saveUploadedAudio(uploaded.buffer, uploaded.originalname, clipName || undefined);
        void process(saved, { force: true });
        res.json({ ok: true, file: saved });
      });
    },
  },
  {
    path: '/holding/resolve',
    method: 'POST',
    handler: async (req: express.Request, res: express.Response) => {
      const file = requireAllowedFile(req, res);
      if (!file) return;
      const action = String(req.body?.action || '').trim() as HoldingAction;
      if (action !== 'overwrite' && action !== 'rename' && action !== 'unfile') {
        res.status(400).json({ error: 'POST { "file", "action": "overwrite" | "rename" | "unfile" }' });
        return;
      }
      try {
        const dest = await resolveHeldFile(file, action);
        void process(dest, { force: true });
        emitNotesIndex();
        res.json({ ok: true, file: dest, action });
      } catch (error: any) {
        res.status(500).json({ error: error?.message || 'holding resolve failed' });
      }
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
