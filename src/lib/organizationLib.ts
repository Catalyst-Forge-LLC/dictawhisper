import { organizationPreview, organizeEntry } from './entryOrganizationLib.ts';
import { entryOperationPending } from './entryOperationLib.ts';
import {moveEntryBundle,keepBothDestination} from './entryBundleLib.ts';
import path from 'path';
import { activity } from './activityLib.ts';
import fs from 'fs';
import { audioFileRegex, findAudioForSidecar } from './audioLib.ts';
import { getSettleMs, inspectFileReadiness, isSkippedWatchPath, requestWhenSettled } from './fileSettleLib.ts';
import { Watcher } from '../classes/Watcher.ts';
import { confirmFolder, moveFile } from './fsLib.ts';
import { checkTranscription, getTranscriptionFilename, process, relocateTranscription } from './transcriptionLib.ts';
import { containedRelative, resolveAllowedPath } from './pathAllowLib.ts';
import { config } from '../config.ts';

const DATE_NAME = /^(?:MTIME_)?(\d{4})-(\d{2})-\d{2}/;

export function dateFromFilename(filePath: string): { year: string; month: string } | null {
  const match = path.basename(filePath).match(DATE_NAME);
  if (!match) return null;
  return { year: match[1], month: match[2] };
}

function uniquePath(destPath: string): string {
  if (!fs.existsSync(destPath)) return destPath;
  const parsed = path.parse(destPath);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

function topFolder(filePath: string, root: string): string {
  const rel = path.relative(root, filePath).replace(/\\/g, '/');
  return (rel.split('/')[0] || '').toLowerCase();
}

function plannedDest(filePath: string, sourceRoot: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const top = topFolder(filePath, sourceRoot);
  if (top === '__inbox') return null;
  if (top === '_holding' || top === '_unfiled') return filePath;
  const date = dateFromFilename(filePath);
  const destFolder = date
    ? path.join(sourceRoot, date.year, date.month)
    : path.join(sourceRoot, '_unfiled');
  return path.join(destFolder, path.basename(filePath));
}

function pipelineIdle(filePath: string, sourceRoot: string): boolean {
  const dest = plannedDest(filePath, sourceRoot);
  if (!dest || path.resolve(dest) !== path.resolve(filePath)) return false;
  const { isProcessed, transcriptionExists } = checkTranscription(filePath);
  return transcriptionExists && isProcessed;
}

export async function organizeAudioFile(filePath: string, sourceRoot: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) return null;
  const top = topFolder(filePath, sourceRoot);
  if (top === '__inbox') return null;
  if (top === '_holding' || top === '_unfiled') return filePath;

  const date = dateFromFilename(filePath);
  const destFolder = date
    ? confirmFolder(path.join(sourceRoot, date.year, date.month))
    : confirmFolder(path.join(sourceRoot, '_unfiled'));
  let destPath = path.join(destFolder, path.basename(filePath));
  if (path.resolve(filePath) === path.resolve(destPath)) return destPath;

  if (fs.existsSync(destPath)) {
    if (date) {
      destPath = uniquePath(path.join(confirmFolder(path.join(sourceRoot, '_holding')), path.basename(filePath)));
      console.log(`[voice-pipeline] destination exists, holding ${destPath}`);
    } else {
      destPath = uniquePath(destPath);
    }
  }

  const srcJson = getTranscriptionFilename(filePath);
  console.log(`[voice-pipeline] move ${filePath} -> ${destPath}`);
  if (fs.existsSync(srcJson)) {
    if(!inspectFileReadiness(filePath,2000).ready) throw new Error('Audio is still changing. Retry after it has settled.');
    const targetJson=keepBothDestination(srcJson,getTranscriptionFilename(destPath),true);
    const moved=await moveEntryBundle(srcJson,targetJson,undefined,true);
    return moved.jsonFile.replace(/\.json$/i,path.extname(filePath));
  }
  await moveFile(filePath, destPath);
  return destPath;
}

async function runPipeline(filePath: string, root: string, options: { front?: boolean } = {}) {
  if (pipelineIdle(filePath, root) || activity.find(filePath)?.stage === 'interrupted') return;
  const dest = await organizeAudioFile(filePath, root);
  if (!dest) return;
  if (dest !== filePath) activity.relocate(filePath, dest);
  const { isProcessed, transcriptionExists } = checkTranscription(dest);
  if (transcriptionExists && isProcessed) return;
  await process(dest, { force: true, front: options.front });
}

/** Explicit retry keeps the same organization path as watched work. */
export async function requestAudioProcessing(file: string, options: { retry?: boolean; force?: boolean } = {}) {
  const root = config.watch.roots.find(root => containedRelative(file, path.resolve(root)));
  if (root) {
    const dest = await organizeAudioFile(file, root);
    if (!dest) throw new Error('This file cannot be organized yet.');
    if (dest !== file) activity.relocate(file, dest);
    file = dest;
  }
  return process(file, options);
}

/** One watcher per root: settle → organize onto the final path → transcribe that path. */
export function initVoiceRootPipeline(sourceFolders: string[] = []) {
  if (!Array.isArray(sourceFolders) || sourceFolders.length === 0) {
    console.error('[voice-pipeline] No source folders specified');
    return;
  }
  const depth = config.watch.recursiveYears ? 2 : 1;
  for (const folder of sourceFolders) {
    if (!fs.existsSync(folder)) {
      console.error(`[voice-pipeline] Source folder does not exist: ${folder}`);
      continue;
    }
    let liveAdds = false;
    new Watcher({
      watchFolder: folder,
      watchDepth: depth,
      ignoreCheck: (filePath) =>
        entryOperationPending(filePath) || isSkippedWatchPath(filePath) ||
        filePath.includes('archive') ||
        filePath.includes('_original') ||
        filePath.includes('_clean'),
      fileMatchRegex: audioFileRegex,
      addHandler: async (filePath) => {
        if (pipelineIdle(filePath, folder) || activity.find(filePath)?.stage === 'interrupted') return;
        if (inspectFileReadiness(filePath, getSettleMs()).ready) {
          await runPipeline(filePath, folder, { front: liveAdds });
          return;
        }
        requestWhenSettled(filePath, () => runPipeline(filePath, folder, { front: true }), {
          label: 'voice-pipeline',
          onWaiting: (status, eligibleAt) => activity.update(filePath, 'waiting_for_file', { eligibleAt, reason: status.reason }),
        });
      },
      changeHandler: (filePath) => {
        if (pipelineIdle(filePath, folder) || activity.find(filePath)?.stage === 'interrupted') return;
        requestWhenSettled(filePath, () => runPipeline(filePath, folder, { front: true }), {
          label: 'voice-pipeline',
          onWaiting: (status, eligibleAt) => activity.update(filePath, 'waiting_for_file', { eligibleAt, reason: status.reason }),
        });
      },
      readyHandler: () => {
        liveAdds = true;
      },
    });
  }
  console.log(`[voice-pipeline] watching ${sourceFolders.join(', ')}`);
}

export function watchAndOrganizeAudioFiles(sourceFolders: string[] = []) {
  initVoiceRootPipeline(sourceFolders);
}

export type HoldingAction = 'overwrite' | 'rename' | 'unfile';

/** Compatibility route preserves whole bundles; destructive overwrite is gated. */
export async function resolveHeldFile(filePath: string, action: HoldingAction): Promise<string> {
  if (action === 'overwrite') throw new Error('Replacement requires a reviewed preview. Use /notes/organization/preview and /apply.');
  const jsonFile = /\.json$/i.test(filePath) ? filePath : getTranscriptionFilename(filePath);
  const preview = organizationPreview(jsonFile, undefined, action === 'unfile');
  const result = await organizeEntry(jsonFile, { action:'keep_both', unfile:action === 'unfile', fingerprint:preview.fingerprint });
  return 'jsonFile' in result ? findAudioForSidecar(String(result.jsonFile)) || String(result.jsonFile) : jsonFile;
}
