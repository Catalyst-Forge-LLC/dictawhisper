import fs from 'fs';
import { audioFileRegex } from './audioLib.ts';
import { isSkippedWatchPath, requestWhenSettled } from './fileSettleLib.ts';
import { Watcher } from '../classes/Watcher.ts';
import { confirmFolder, moveFile } from './fsLib.ts';

async function organizeAudioFile(filePath: string, match: RegExpMatchArray | null, sourceRoot: string) {
  if (!match) {
    console.log(`[watcher-filename-error] Filename does not match expected pattern: ${filePath}`);
    return;
  }
  const fileName = filePath.split('\\').pop();
  const year = match[1];
  const month = match[2];
  const dateFolder = `${year}/${month}`;
  if (!filePath.includes(dateFolder)) {
    const destFolder = confirmFolder(`${sourceRoot}/${dateFolder}`);
    const destPath = `${destFolder}/${fileName}`;
    if (fs.existsSync(destPath)) {
      console.log(`[watcher-file-exists] Destination file already exists, moving to holding: ${destPath}`);
      const holdingFolder = confirmFolder(`${sourceRoot}/_holding`);
      await moveFile(filePath, `${holdingFolder}/${fileName}`);
      return;
    }
    console.log(`[watcher-file-move] Moving file ${filePath} to ${destPath}`);
    await moveFile(filePath, destPath);
  } else {
    console.log(`[watcher-file-move] File is already in the correct folder: ${filePath}`);
  }
}

export function watchAndOrganizeAudioFiles(sourceFolders: string[] = []) {
  if (!Array.isArray(sourceFolders) || sourceFolders.length === 0) {
    console.error('[watcher-error] No source folders specified for audio file organization');
    return;
  }
  const watchers: (Watcher | null)[] = sourceFolders.map(folder => {
    if (!fs.existsSync(folder)) {
      console.error(`[watcher-error] Source folder does not exist: ${folder}`);
      return null;
    }
    return new Watcher({
      watchFolder: folder,
      watchDepth: 0,
      ignoreCheck: (filePath, stats) => {
        if (isSkippedWatchPath(filePath)) return true;
        if (stats && stats.isFile()) {
          return filePath.includes('_original') || !audioFileRegex.test(filePath);
        } else {
          return false; // Ignore directories/folders
        }
      },
      fileMatchRegex: /\\(\d{4})-(\d{2})-\d{2}/,
      addHandler: async (filePath, match) => {
        requestWhenSettled(filePath, () => organizeAudioFile(filePath, match, sourceFolders[0]), {
          label: 'voice-organize',
        });
      },
      changeHandler: (filePath, match) => {
        requestWhenSettled(filePath, () => organizeAudioFile(filePath, match, sourceFolders[0]), {
          label: 'voice-organize',
        });
      },
    });
  }).filter(watcher => watcher !== null) as Watcher[];
  console.log(`[watcher] Initialized watchers for source folders: ${sourceFolders.join(', ')}`);
  return watchers;
};
