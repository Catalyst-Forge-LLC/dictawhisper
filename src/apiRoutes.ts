import { ollanetIsConfigured } from './lib/ollanetReadyLib.ts';
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
  searchJournalPage,
} from './lib/journalService.ts';
import { EntryCursorError, type SearchMode, type SearchSort } from './lib/journalIndexLib.ts';
import { activity } from './lib/activityLib.ts';
import { inspectFileReadiness } from './lib/fileSettleLib.ts';
import { getWhisperWorkerStatus } from './lib/whisperLib.ts';
import { requestCleanup } from './lib/transcriptionLib.ts';
import { q } from './lib/queueLib.ts';
import { config } from './config.ts';
import { resolveWhisperModel } from './lib/whisperLib.ts';
import { getHealthReport } from './lib/healthLib.ts';
import { resolveAllowedPath } from './lib/pathAllowLib.ts';
import { audioContentType, findAudioForSidecar, saveUploadedAudio, audioExtensions, MAX_UPLOAD_BYTES } from './lib/audioLib.ts';
import { contentDisposition } from './lib/downloadLib.ts';
import { applyConsolidateGroups, buildConsolidatePlan } from './lib/tagConsolidateLib.ts';
import { resolveHeldFile, requestAudioProcessing, type HoldingAction } from './lib/organizationLib.ts';
import { getProbeJob, startProbeJob, markReviewedAudio } from './lib/audioProbeLib.ts';

import { extractMayDos, getMayDoBackfill, startMayDoBackfill, stopMayDoBackfill, resumeMayDoBackfill, mayDoCapabilities } from './lib/mayDoService.ts';
import { isMayDoStatus, parseMayDoFilter, parseMayDoStatusSet } from './lib/mayDoLib.ts';
import { BundleError, listTrash, moveToTrash, previewRestore, restoreTrash, purgeTrash, recoverTrash } from './lib/entryBundleLib.ts';
import { organizationPreview, organizeEntry } from './lib/entryOrganizationLib.ts';
import { backfillEntryIds } from './lib/entryIdentityLib.ts';
import { effectiveSettings } from './lib/settingsLib.ts';
import { rebuildJournalIndex } from './lib/journalService.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
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
  {path:'/tools/probe/mark',method:'POST',handler:async(req:express.Request,res:express.Response)=>{try{res.json(await markReviewedAudio(req.body?.files));}catch(error){res.status(409).json({error:String(error)});}}},
  {path:'/settings',method:'GET',handler:(_req:express.Request,res:express.Response)=>res.json(effectiveSettings())},
  {path:'/tools/index/rebuild',method:'POST',handler:async(_req:express.Request,res:express.Response)=>{try{const result=await rebuildJournalIndex([...new Set([...config.watch.roots,config.watch.browserDropFolder])],{embed:false});emitNotesIndex();res.json({ok:true,...result});}catch(error){res.status(409).json({error:String(error)});}}},
  { path:'/notes/trash', method:'GET', handler:(_req:express.Request,res:express.Response)=>{try{res.json({items:listTrash()});}catch(error){res.status(409).json({error:String(error)});}} },
  ...['remove','preview','restore','purge','recover'].map(action=>({path:`/notes/trash/${action}`,method:'POST',handler:async(req:express.Request,res:express.Response)=>{
    try {
      const id=String(req.body?.id||'');
      const result=action==='remove' ? await moveToTrash(String(req.body?.file||''),req.body?.requestId) : action==='preview' ? previewRestore(id) : action==='restore' ? await restoreTrash(id) : action==='purge' ? purgeTrash(id,req.body?.confirmation) : await recoverTrash(id);
      res.json(result);
    }catch(error){res.status(409).json({error:error instanceof Error?error.message:String(error),details:error instanceof BundleError?error.details:undefined});}
  }})),
  ...['preview','apply'].map(action=>({path:`/notes/organization/${action}`,method:'POST',handler:async(req:express.Request,res:express.Response)=>{
    try { const file=String(req.body?.file||''); const result=action==='preview'?organizationPreview(file,req.body?.date,req.body?.unfile===true):await organizeEntry(file,req.body||{});res.json(result); }
    catch(error){res.status(409).json({error:error instanceof Error?error.message:String(error),details:error instanceof BundleError?error.details:undefined});}
  }})),
  {path:'/tools/entries/identity',method:'POST',handler:(_req:express.Request,res:express.Response)=>{try{res.json(backfillEntryIds());emitNotesIndex();}catch(error){res.status(409).json({error:String(error)});}}},
  { path: '/audio/capabilities', method: 'GET', handler: (_req: express.Request, res: express.Response) => {
    res.json({ formats: audioExtensions, maxBytes: MAX_UPLOAD_BYTES, canSave: Boolean(config.watch.browserDropFolder),
      transcriptionEnabled: config.queues.transcription.active, cleanupEnabled: ollanetIsConfigured() && config.queues.processing.active,
      worker: getWhisperWorkerStatus(), reason: config.queues.transcription.active ? 'Saved audio waits safely while the worker starts or recovers.' : 'Transcription queue is disabled. Audio can still be saved.' });
  } },
  { path: '/audio/upload', method: 'GET', handler: (req: express.Request, res: express.Response) => {
    const item = activity.byUpload(String(req.query.uploadId || '')); res.json({ found: Boolean(item), item });
  } },
  { path: '/notes/activity', method: 'GET', handler: (_req: express.Request, res: express.Response) => {
    res.json({ ...activity.snapshot(), mayDoBackfill: getMayDoBackfill(), queues: { transcription: { queued: q.transcription?.length() || 0, running: q.transcription?.running() || 0 }, cleanup: { queued: q.processing?.length() || 0, running: q.processing?.running() || 0 } } });
  } },
  { path: '/notes/activity/retry', method: 'POST', handler: async (req: express.Request, res: express.Response) => {
    const item = activity.byId(String(req.body?.id || ''));
    if (!item) { res.status(404).json({ error: 'Activity item not found.' }); return; }
    if (!item.stage.startsWith('failed_') && item.stage !== 'interrupted') { res.status(409).json({ error: 'This item is already processing or completed. Refresh Activity.' }); return; }
    const allowed = resolveAllowedPath(item.audioFile); if (!allowed.ok) { res.status(403).json({ error: allowed.error }); return; }
    try {
      if (item.stage === 'failed_cleanup' || item.stage === 'interrupted' && ['cleaning','queued_cleanup'].includes(item.resumeStage || '')) requestCleanup(item.jsonFile);
      else if (item.stage === 'failed_maydos' || item.stage === 'interrupted' && item.resumeStage === 'extracting_maydos') { await extractMayDos(item.jsonFile); }
      else await requestAudioProcessing(item.audioFile, { retry: true });
      res.status(202).json({ ok: true, item: activity.byId(item.id) });
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  } },
  { path: '/notes/activity/process-now', method: 'POST', handler: async (req: express.Request, res: express.Response) => {
    const item = activity.byId(String(req.body?.id || ''));
    if (!item) { res.status(404).json({ error: 'Activity item not found.' }); return; }
    if (item.stage !== 'waiting_for_file') { res.status(409).json({ error: 'This item is no longer waiting. Refresh Activity.' }); return; }
    const allowed = resolveAllowedPath(item.audioFile); if (!allowed.ok) { res.status(403).json({ error: allowed.error }); return; }
    if (!inspectFileReadiness(item.audioFile, 2000).ready) { res.status(409).json({ error: 'File is still changing or empty. Wait for syncing to finish.' }); return; }
    try { await requestAudioProcessing(item.audioFile, { force: true }); res.status(202).json({ ok: true, item: activity.byId(item.id) }); }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
  } },
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
      const asDownload = queryFlag(req.query.download);
      res.setHeader('Content-Type', audioContentType(audioAllowed.path));
      res.setHeader(
        'Content-Disposition',
        contentDisposition(audioAllowed.path, asDownload ? 'attachment' : 'inline'),
      );
      res.sendFile(audioAllowed.relative, { root: audioAllowed.root });
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
        const folder = ['active', 'unfiled', 'holding'].includes(String(req.query.folder)) ? req.query.folder as 'active' | 'unfiled' | 'holding' : undefined;
        const attention = queryFlag(req.query.attention);
        if (year || month || unreadable || starred || all || folder || attention) {
          res.json({
            notes: listInboxNotes({
              year: year || undefined,
              month: month || undefined,
              unreadable: unreadable || undefined,
              starred: starred || undefined,
              all: all || undefined,
              folder,
              attention,
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
        const folder = ['active', 'unfiled', 'holding'].includes(String(req.query.folder)) ? req.query.folder as 'active' | 'unfiled' | 'holding' : undefined;
        let statuses;
        try { statuses = parseMayDoStatusSet(req.query.mayDoStatus); }
        catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); return; }
        const paged = req.query.page === '1';
        const result = await (paged ? searchJournalPage : searchJournalIndex)({
          cursor: paged && typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
          folder,
          attention: queryFlag(req.query.attention),
          mayDos: statuses || parseMayDoFilter(req.query.mayDos),
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
        res.json(paged ? result : { hits: result, count: (result as unknown[]).length });
      } catch (error) {
        if (error instanceof EntryCursorError) { res.status(error.code === 'cursor_expired' ? 409 : 400).json({ error: error.message, code: error.code }); return; }
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
      const sidecar = allowed.path.toLowerCase().endsWith('.json')
        ? allowed.path
        : getTranscriptionFilename(allowed.path);
      const sidecarAllowed = resolveAllowedPath(sidecar);
      if (!sidecarAllowed.ok) {
        res.status(403).json({ error: sidecarAllowed.error });
        return;
      }
      if (queryFlag(req.query.download)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', contentDisposition(sidecarAllowed.path, 'attachment'));
        res.sendFile(sidecarAllowed.relative, { root: sidecarAllowed.root });
        return;
      }
      try {
        const note = readTranscription(sidecarAllowed.path);
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
      if (req.body?.mayDo && (typeof req.body.mayDo.id !== 'string' || !isMayDoStatus(req.body.mayDo.status))) { res.status(400).json({ error: 'Invalid MayDo ID or status.' }); return; }
      if (req.body?.displayTitle !== undefined && (typeof req.body.displayTitle !== 'string' || req.body.displayTitle.trim().length > 160)) { res.status(400).json({ error: 'Display title must be text of at most 160 characters.' }); return; }
      if (req.body?.displayTitle === undefined && req.body?.tags === undefined && typeof req.body?.starred !== 'boolean' && !req.body?.mayDo) {
        res.status(400).json({ error: 'POST { "file", "displayTitle"?: string, "tags"?: string[], "starred"?: boolean, "mayDo"?: { "id", "status" } }' });
        return;
      }
      try {
        res.json(
          patchTranscription(allowed.path, {
            displayTitle: req.body?.displayTitle,
            mayDo: req.body?.mayDo,
            tags: req.body?.tags,
            expectedTags: req.body?.expectedTags,
            starred: typeof req.body?.starred === 'boolean' ? req.body.starred : undefined,
          }),
        );
      } catch (error: any) {
        const status = String(error?.message || '').includes('not found') ? 404 : String(error?.message || '').includes('changed elsewhere') ? 409 : 500;
        res.status(status).json({ error: error?.message || 'failed to update note' });
      }
    },
  },
  {
    path: '/notes/may-dos/extract', method: 'POST',
    handler: async (req: express.Request, res: express.Response) => {
      const file = requireAllowedFile(req, res);
      if (!file) return;
      const allowed = resolveAllowedPath(file.toLowerCase().endsWith('.json') ? file : getTranscriptionFilename(file));
      if (!allowed.ok) { res.status(403).json({ error: allowed.error }); return; }
      try { res.json(await extractMayDos(allowed.path)); }
      catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : 'MayDo extraction failed.' }); }
    },
  },
  { path: '/notes/may-dos/capabilities', method: 'GET', handler: (_req: express.Request, res: express.Response) => res.json(mayDoCapabilities()) },
  { path: '/tools/may-dos/backfill', method: 'GET', handler: (_req: express.Request, res: express.Response) => res.json(getMayDoBackfill()) },
  {
    path: '/tools/may-dos/backfill', method: 'POST',
    handler: (req: express.Request, res: express.Response) => {
      const action = req.body?.action || (req.body?.stop === true ? 'stop' : 'start');
      if (!['start', 'stop', 'resume', 'retry_failed'].includes(action)) { res.status(400).json({ error: 'Unknown backfill action.' }); return; }
      try {
        if (action === 'stop') { res.json(stopMayDoBackfill(req.body?.id)); return; }
        if (action === 'resume' || action === 'retry_failed') { res.json(resumeMayDoBackfill(req.body?.id, action === 'retry_failed')); return; }
      } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Backfill changed. Refresh and retry.' }); return; }
      const year = typeof req.body?.year === 'string' ? req.body.year.trim() : '';
      if (year && !/^\d{4}$/.test(year)) { res.status(400).json({ error: 'Year must have four digits.' }); return; }
      try { res.json(startMayDoBackfill({ refresh: req.body?.refresh === true, year: year || undefined })); }
      catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not start MayDo backfill.' }); }
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
      try { res.status(202).json({ ok: true, item: requestCleanup(file), accepted: true }); }
      catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
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
        const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId : '';
        if (uploadId && !/^[A-Za-z0-9_-]{8,100}$/.test(uploadId)) { res.status(400).json({error:'Invalid upload identity.'}); return; }
        const previous = uploadId ? activity.byUpload(uploadId) : undefined;
        if (previous) { res.status(202).json({ok:true,saved:true,file:previous.audioFile,item:previous}); return; }
        try {
          const saved = saveUploadedAudio(uploaded.buffer, uploaded.originalname, clipName || undefined);
          const item = activity.update(saved, 'waiting_for_file', { originalName: uploaded.originalname, uploadId: uploadId || undefined });
          void process(saved, { force: true });
          res.status(202).json({ ok: true, saved: true, file: saved, item });
        } catch(error) { res.status(400).json({error:error instanceof Error ? error.message : 'Audio could not be saved.'}); }
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
