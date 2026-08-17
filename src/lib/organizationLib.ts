import path from 'path';
import fs from 'fs';
import { audioFileRegex, findAudioForSidecar } from './audioLib.ts';
import { isSkippedWatchPath, requestWhenSettled } from './fileSettleLib.ts';
import { Watcher } from '../classes/Watcher.ts';
import { confirmFolder, moveFile } from './fsLib.ts';
import { checkTranscription, getTranscriptionFilename, process, relocateTranscription } from './transcriptionLib.ts';
import { config } from '../config.ts';

const DATE_NAME = /^(\d{4})-(\d{2})-\d{2}/;

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
  await moveFile(filePath, destPath);
  if (fs.existsSync(srcJson)) {
    const destJson = getTranscriptionFilename(destPath);
    await moveFile(srcJson, destJson);
    relocateTranscription(srcJson, destJson);
  }
  return destPath;
}

async function runPipeline(filePath: string, root: string) {
  if (pipelineIdle(filePath, root)) return;
  const dest = await organizeAudioFile(filePath, root);
  if (!dest) return;
  const { isProcessed, transcriptionExists } = checkTranscription(dest);
  if (transcriptionExists && isProcessed) return;
  await process(dest, { force: true });
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
    new Watcher({
      watchFolder: folder,
      watchDepth: depth,
      ignoreCheck: (filePath) =>
        isSkippedWatchPath(filePath) ||
        filePath.includes('archive') ||
        filePath.includes('_original') ||
        filePath.includes('_clean'),
      fileMatchRegex: audioFileRegex,
      addHandler: async (filePath) => {
        if (pipelineIdle(filePath, folder)) return;
        requestWhenSettled(filePath, () => runPipeline(filePath, folder), { label: 'voice-pipeline' });
      },
      changeHandler: (filePath) => {
        if (pipelineIdle(filePath, folder)) return;
        requestWhenSettled(filePath, () => runPipeline(filePath, folder), { label: 'voice-pipeline' });
      },
    });
  }
  console.log(`[voice-pipeline] watching ${sourceFolders.join(', ')}`);
}

export function watchAndOrganizeAudioFiles(sourceFolders: string[] = []) {
  initVoiceRootPipeline(sourceFolders);
}

export type HoldingAction = 'overwrite' | 'rename' | 'unfile';

/** Move a holding/unfiled note into YYYY/MM or _unfiled. */
export async function resolveHeldFile(filePath: string, action: HoldingAction): Promise<string> {
  if (!fs.existsSync(filePath)) throw new Error('file not found');
  if (filePath.toLowerCase().endsWith('.json')) {
    filePath = findAudioForSidecar(filePath) || filePath;
  }
  const resolved = path.resolve(filePath);
  const root = config.watch.roots.find((candidate) => {
    const prefix = path.resolve(candidate);
    return resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`);
  });
  if (!root) throw new Error('file is not under a watch root');

  const date = dateFromFilename(filePath);
  let destFolder: string;
  if (action === 'unfile' || !date) {
    destFolder = confirmFolder(path.join(root, '_unfiled'));
  } else {
    destFolder = confirmFolder(path.join(root, date.year, date.month));
  }
  let destPath = path.join(destFolder, path.basename(filePath));
  if (action === 'rename' && fs.existsSync(destPath)) {
    destPath = uniquePath(destPath);
  }
  if (action === 'overwrite' && fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(filePath)) {
    fs.unlinkSync(destPath);
    const destJson = getTranscriptionFilename(destPath);
    if (fs.existsSync(destJson)) fs.unlinkSync(destJson);
  }

  const srcJson = getTranscriptionFilename(filePath);
  await moveFile(filePath, destPath);
  if (fs.existsSync(srcJson)) {
    const destJson = getTranscriptionFilename(destPath);
    await moveFile(srcJson, destJson);
    relocateTranscription(srcJson, destJson);
  }
  return destPath;
}
