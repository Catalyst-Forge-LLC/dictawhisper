import fs from 'fs';

export async function moveFile(filePath: string, destPath: string): Promise<void> {
  console.log(`[fs-move] Moving file from ${filePath} to ${destPath}`);
  return new Promise((resolve, reject) => {
    const fileExists = fs.existsSync(destPath);
    // if the file exist in destPath, reject with an error
    if (fileExists) {
      const error = new Error(`Destination file already exists: ${destPath}`);
      console.error(`[fs-move-error] ${error.message}`);
      return resolve();
    }
    fs.copyFile(filePath, destPath, (err) => {
      if (err) {
        console.error(`[fs-copy-error] Error copying file ${filePath} to ${destPath}:`, err);
        reject(err);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error(`[fs-delete-error] Error deleting original file ${filePath}:`, unlinkErr);
            reject(unlinkErr);
          } else {
            console.log(`[fs-delete] Moved ${filePath} to ${destPath}`);
            resolve();
          }
        });
      }
    });
  });
}

export function confirmFolder(folderPath: string): string {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
}
