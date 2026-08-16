import fs from 'fs';
import * as child_process from 'child_process';
import * as path from 'path';
import { config } from '../config.ts';

export const audioExtensions = ['webm', 'mp3', 'm4a'];

export const audioFileRegex = new RegExp(`\\.(${audioExtensions.join('|')})$`, 'i');

export function saveAudioFile(dataUrl: string, clipName: string) {
  const folder = config.watch.browserDropFolder;
  fs.mkdirSync(folder, { recursive: true });
  let filePath = path.join(folder, `${clipName}.webm`);
  let data = dataUrl.replace(/data:.*?;base64,/i, '');
  console.log('[save-audio-file] Saving Audio File', { filePath, dataLength: data.length });
  let fileBuffer = Buffer.from(data, 'base64');
  fs.writeFileSync(filePath, fileBuffer);
}

export async function cleanAudioFile(file: string, cleanAgain: boolean = false): Promise<boolean> {
    // Run ffmpeg to clean the audio file before transcription
    const cleanFile = path.join(
      path.dirname(file),
      path.basename(file, path.extname(file)) + '_clean' + path.extname(file)
    );
    const originalFile = path.join(
      path.dirname(file),
      path.basename(file, path.extname(file)) + '_original' + path.extname(file)
    );
    if (fs.existsSync(originalFile) && !cleanAgain) {
      return false;
    }
    const ffmpegCmd = `ffmpeg -y -i "${file}" -af "silenceremove=1:0:-50dB,afftdn=nr=15:nf=-40,highpass=f=200,volume=1.5" -c:a libmp3lame -b:a 128k "${cleanFile}"`;

    await new Promise<void>((resolve, reject) => {
      child_process.exec(ffmpegCmd, (error, stdout, stderr) => {
        if (error) {
          console.error(`[ffmpeg] Error cleaning file: ${error.message}`);
          return reject(error);
        }
        fs.copyFileSync(file, originalFile);
        fs.copyFileSync(cleanFile, file);
        fs.unlinkSync(cleanFile);
        console.log(`[ffmpeg] Cleaned file created at: ${file}`);
        resolve();
      });
    });

    return true;

}
