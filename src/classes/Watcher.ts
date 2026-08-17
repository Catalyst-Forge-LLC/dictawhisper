import chokidar, { FSWatcher } from 'chokidar';
import fs from 'fs';

type WatcherConfig = {
  watchFolder: string,
  watchDepth: number,
  logEvents?: boolean,
  ignoreCheck: (path: string, stats?: fs.Stats) => boolean,
  fileMatchRegex: RegExp,
  addHandler: (filePath: string, match: RegExpMatchArray, watchFolder: string) => Promise<void>
  changeHandler?: (filePath: string, match: RegExpMatchArray, watchFolder: string) => void,
  unlinkHandler?: (filePath: string) => void,
  addDirHandler?: (filePath: string) => void,
  unlinkDirHandler?: (filePath: string) => void,
  errorHandler?: (error: Error) => void,
  readyHandler?: () => void
};

const liveWatchers: Watcher[] = [];

export async function closeAllWatchers(): Promise<void> {
  const closing = liveWatchers.splice(0, liveWatchers.length);
  await Promise.all(closing.map((watcher) => watcher.close()));
}

export class Watcher {
  private watcher: FSWatcher;
  logEvents: boolean = false;

  constructor(config: WatcherConfig = {watchFolder: '', watchDepth: 0, logEvents: false, ignoreCheck: () => false, fileMatchRegex: new RegExp(''), addHandler: async () => {}}) {
    this.watcher = chokidar.watch(config.watchFolder, { persistent: true, ignored: config.ignoreCheck, depth: config.watchDepth });
    liveWatchers.push(this);

    this.watcher
      .on('add', async (filePath) => {
        const match = filePath.match(config.fileMatchRegex);
        if (match) {
          if (this.logEvents) {
            console.log(`[watcher] File ${filePath} has been added`);
          }
          await config.addHandler(filePath, match, config.watchFolder);
        }
      })
      .on('change', (filePath) => {
        const match = filePath.match(config.fileMatchRegex);
        if (match) {
          if (this.logEvents) {
            console.log(`[watcher] File ${filePath} has been changed`);
          }
          config.changeHandler?.(filePath, match, config.watchFolder);
        }
      })
      .on('unlink', (filePath) => {
        if (this.logEvents) {
          console.log(`[watcher] File ${filePath} has been removed`);
        }
        config.unlinkHandler?.(filePath);
      })
      .on('addDir', (filePath) => {
        if (this.logEvents) {
          console.log(`[watcher] Directory ${filePath} has been added`);
        }
        config.addDirHandler?.(filePath);
      })
      .on('unlinkDir', (filePath) => {
        if (this.logEvents) {
          console.log(`[watcher] Directory ${filePath} has been removed`);
        }
        config.unlinkDirHandler?.(filePath);
      })
      .on('error', (error: any) => {
        if (this.logEvents) {
          console.log(`[watcher-error] Watcher error: ${error}`);
        }
        config.errorHandler?.(error);
      })
      .on('ready', () => {
        console.log(`[watcher] Initial scan complete of ${config.watchFolder}. Ready for changes`);
        config.readyHandler?.();
      });
  }

  close() {
    return this.watcher.close();
  }
}
