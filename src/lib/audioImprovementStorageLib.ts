import fs from 'node:fs';
import path from 'node:path';
import { allowedRoots, resolveAllowedPath } from './pathAllowLib.ts';

/** Called only by confirmed permanent Trash deletion. Validate every target before unlinking. */
export function purgeAudioImprovementHistory(entryId: string) {
  const files: string[] = [], directories: string[] = [];
  function exact(file: string) {
    const allowed = resolveAllowedPath(file);
    if (!allowed.ok) throw new Error(allowed.error);
    const canonical = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (canonical(allowed.path) !== canonical(file)) throw new Error('Audio improvement storage redirects elsewhere. Saved files were kept.');
    return allowed.path;
  }
  for (const root of [...new Set(allowedRoots())]) {
    const base = exact(path.join(root, '.dictawhisper', 'audio-improvements'));
    if (!fs.existsSync(base)) continue;
    for (const id of fs.readdirSync(base)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      const directory = exact(path.join(base, id)), manifest = exact(path.join(directory, 'job.json'));
      if (!fs.existsSync(manifest)) continue;
      const job = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (job.entryId !== entryId) continue;
      if (job.id !== id || !/^\.(webm|mp3|m4a|wav|ogg)$/i.test(job.sourceExt)) throw new Error('Invalid audio improvement manifest. Saved files were kept.');
      for (const name of ['source' + job.sourceExt, 'enhanced.wav', 'candidate.json', 'previous.json', 'job.json']) {
        const file = exact(path.join(directory, name));
        if (fs.existsSync(file)) { if (!fs.statSync(file).isFile()) throw new Error('Unexpected audio improvement artifact.'); files.push(file); }
      }
      directories.push(directory);
    }
  }
  for (const file of files) fs.unlinkSync(file);
  for (const directory of directories) if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
}
