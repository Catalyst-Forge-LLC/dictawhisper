import fs from 'fs';
import path from 'path';
import { allowedRoots } from './pathAllowLib.ts';

function pathInsideWatchRoot(filePath: string): string {
  const resolved = path.resolve(filePath);
  for (const root of allowedRoots()) {
    const rel = path.relative(root, resolved);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    return resolved;
  }
  throw new Error(`path is outside configured watch roots: ${filePath}`);
}

export async function moveFile(filePath: string, destPath: string): Promise<void> {
  const src = pathInsideWatchRoot(filePath);
  const dest = pathInsideWatchRoot(destPath);
  console.log(`[fs-move] Moving file from ${src} to ${dest}`);
  return new Promise((resolve, reject) => {
    const fileExists = fs.existsSync(dest);
    // if the file exist in destPath, reject with an error
    if (fileExists) {
      const error = new Error(`Destination file already exists: ${dest}`);
      console.error(`[fs-move-error] ${error.message}`);
      return resolve();
    }
    fs.copyFile(src, dest, (err) => {
      if (err) {
        console.error('[fs-copy-error] copy failed', src, dest, err);
        reject(err);
      } else {
        fs.unlink(src, (unlinkErr) => {
          if (unlinkErr) {
            console.error('[fs-delete-error] unlink failed', src, unlinkErr);
            reject(unlinkErr);
          } else {
            console.log(`[fs-delete] Moved ${src} to ${dest}`);
            resolve();
          }
        });
      }
    });
  });
}

export function confirmFolder(folderPath: string): string {
  const allowed = pathInsideWatchRoot(folderPath);
  if (!fs.existsSync(allowed)) {
    fs.mkdirSync(allowed, { recursive: true });
  }
  return allowed;
}
