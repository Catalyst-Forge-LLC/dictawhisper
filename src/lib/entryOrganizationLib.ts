import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveAllowedPath } from './pathAllowLib.ts';
import { BundleError, entryBundleFiles, keepBothDestination, moveEntryBundle, moveToTrash, restoreTrash } from './entryBundleLib.ts';

function readable(file: string) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, title: json.displayTitle || path.basename(file), date: json.recordedDate || path.basename(file).match(/\d{4}-\d{2}-\d{2}/)?.[0] || 'Unknown date', preview: String(json.cleanedTranscription || json.text || '').slice(0, 400), files: entryBundleFiles(file).map(file => ({file, bytes:fs.statSync(file).size})) };
}
export function organizationPreview(file: string, date?: string, unfile = false) {
  const allowed = resolveAllowedPath(file); if (!allowed.ok) throw new BundleError(allowed.error);
  file = allowed.path;
  entryBundleFiles(file);
  let basename = path.basename(file);
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date+'T12:00:00Z').toISOString().slice(0,10) !== date) throw new BundleError('Choose a valid recording date.');
    basename = `${date}_${basename.replace(/^(?:MTIME_)?\d{4}-\d{2}-\d{2}[_ -]?/, '')}`;
  }
  const day = date || basename.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!day && !unfile) throw new BundleError('Assign a recording date before filing this entry.');
  const target = path.join(allowed.root, ...(unfile ? ['_unfiled'] : [day!.slice(0,4),day!.slice(5,7)]), basename);
  if (path.resolve(target) === path.resolve(file)) throw new BundleError('This entry is already at the selected destination.');
  const incoming = readable(file), existing = fs.existsSync(target) ? readable(target) : null;
  const keepBoth = keepBothDestination(file, target);
  const fingerprint = createHash('sha256').update(JSON.stringify({ incoming, existing, target, date, unfile, stats: [...incoming.files, ...(existing?.files || [])].map(row => ({file:row.file,mtime:fs.statSync(row.file).mtimeMs,bytes:row.bytes})) })).digest('hex');
  return { file, target, keepBoth, incoming, existing, date, unfile, fingerprint, conflict: keepBoth !== target };
}
export async function organizeEntry(file: string, options: {date?:string; unfile?:boolean; action?:string; fingerprint?:string; confirmed?:boolean}) {
  const preview = organizationPreview(file, options.date, options.unfile === true);
  if (options.fingerprint !== preview.fingerprint) throw new BundleError('Files changed since the preview. Refresh the preview before moving them.');
  const action = options.action || 'keep_both';
  if (!['keep_both','keep_existing','replace'].includes(action)) throw new BundleError('Choose Keep both, Keep existing, or Replace existing.');
  if (action === 'keep_existing' && !preview.existing) throw new BundleError('There is no existing entry to keep.');
  if (action === 'keep_existing') return {...await moveToTrash(file), keptExisting:true};
  let backupId: string | undefined;
  if (action === 'replace' && preview.conflict) {
    if (options.confirmed !== true || !preview.existing) throw new BundleError('Replacement requires confirmation and a readable existing transcript. Choose Keep both otherwise.');
    backupId = (await moveToTrash(preview.target)).trashId;
  }
  try {
    const moved = await moveEntryBundle(file, action === 'keep_both' ? preview.keepBoth : preview.target, json => {
      if (options.date) { json.recordedDate=options.date; json.recordedAtSource='user'; delete json.recordedAt; }
    });
    return {...moved, backupId};
  } catch(error) {
    if (backupId) { try { await restoreTrash(backupId, false); } catch { throw new BundleError('The move failed. The existing entry is preserved in Trash; restore it there.', {backupId, cause:String(error)}); } }
    throw error;
  }
}
