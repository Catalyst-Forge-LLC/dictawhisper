import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { audioExtensions } from './audioLib.ts';
import { allowedRoots, containedRelative, resolveAllowedPath } from './pathAllowLib.ts';
import { isSkippedWatchPath } from './fileSettleLib.ts';
import { activity, isWorkingStage } from './activityLib.ts';
import { withEntryOperation, assertEntryWritable } from './entryOperationLib.ts';
import { ensureEntryId } from './entryIdentityLib.ts';
import { forgetTranscription, relocateTranscription, emitNotesIndex, readTranscription } from './transcriptionLib.ts';
import type { TranscriptionDocument } from '../types/transcription.ts';
import {getJournalIndex} from './journalIndexLib.ts';

type BundleFile = { original: string; stored: string; size: number; hash?: string };
type Manifest = { version: 1; id: string; entryId: string; jsonFile: string; title: string; deletedAt: string; state: 'preparing' | 'trashed' | 'restoring' | 'restored' | 'rolled_back' | 'recovery_needed'; files: BundleFile[]; restoredJsonFile?: string; error?: string };
export class BundleError extends Error {
  details: unknown;
  constructor(message: string, details?: unknown) { super(message); this.details = details; }
}
const same = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const ID = /^[a-z0-9][a-z0-9-]{15,80}$/i;
function ownedTrashDirectory(root: string, id?: string) {
  const canonicalRoot=checked(root).path, expected=path.join(canonicalRoot,'.dictawhisper','trash',...(id?[id]:[]));
  const actual=checked(expected).path;
  if(!same(actual,expected))throw new BundleError('Trash directory redirects to another location. All files were kept.');
  return actual;
}
function checked(file: string) {
  const allowed = resolveAllowedPath(file);
  if (!allowed.ok) throw new BundleError(allowed.error);
  return allowed;
}
function entryPath(file: string, allowWaiting = false) {
  const allowed = checked(file);
  if (isSkippedWatchPath(allowed.path) || !/\.json$/i.test(allowed.path) || !fs.existsSync(allowed.path)) throw new BundleError('A readable entry JSON is required.');
  const document=JSON.parse(fs.readFileSync(allowed.path,'utf8'));
  if(!document || typeof document!=='object' || Array.isArray(document) || !(typeof document.text==='string'||typeof document.cleanedTranscription==='string'||Array.isArray(document.segments)||document.audioError)) throw new BundleError('This JSON file is not an entry transcript. It was kept unchanged.');
  const stage=activity.find(allowed.path)?.stage || 'ready';
  if (isWorkingStage(stage) && !(allowWaiting && stage==='waiting_for_file')) throw new BundleError('Processing is active for this entry. Wait for it to finish before moving it.');
  return allowed;
}
export function entryBundleFiles(jsonFile: string, allowWaiting = false): string[] {
  const { path: file } = entryPath(jsonFile,allowWaiting), base = file.replace(/\.json$/i, '');
  const files = [file];
  for (const suffix of ['', '_original', '_clean']) for (const ext of audioExtensions) {
    const candidate = `${base}${suffix}.${ext}`;
    if (fs.existsSync(candidate)) { checked(candidate); files.push(candidate); }
  }
  return [...new Set(files)];
}
async function hash(file: string) {
  const digest = createHash('sha256');
  for await (const part of createReadStream(file)) digest.update(part);
  return digest.digest('hex');
}
function writeManifest(directory: string, manifest: Manifest) {
  checked(directory); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'manifest.json'), temporary=path.join(directory,randomUUID()+'.tmp');
  try{fs.writeFileSync(temporary,JSON.stringify(manifest,null,2),{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export function writeEntryJson(file: string, text: string) {
  checked(file);
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function locate(id: string): { directory: string; manifest: Manifest } | null {
  if (!ID.test(id)) throw new BundleError('Invalid Trash ID.');
  for (const root of [...new Set(allowedRoots())]) {
    const directory = ownedTrashDirectory(root,id), file = path.join(directory, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    if(fs.lstatSync(file).isSymbolicLink())throw new BundleError('Trash manifest redirects to another file. All files were kept.');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    if (manifest.version !== 1 || manifest.id !== id || typeof manifest.jsonFile !== 'string' || !/\.json$/i.test(manifest.jsonFile) || !Array.isArray(manifest.files) || !manifest.files.length) throw new BundleError('Invalid Trash manifest. The bundle was kept.');
    for (const row of manifest.files) {
      const base = manifest.jsonFile.slice(0, -5);
      const suffix = typeof row.original === 'string' ? row.original.slice(base.length) : '';
      const validAudio = ['', '_original', '_clean'].some(part => audioExtensions.some(ext => suffix.toLowerCase() === `${part}.${ext}`));
      if (typeof row.original !== 'string' || !(same(row.original, manifest.jsonFile) || (row.original.startsWith(base) && validAudio)) || typeof row.stored !== 'string' || !same(path.dirname(row.stored), directory) || !/^file-\d+\.[a-z0-9]+$/i.test(path.basename(row.stored)) || !Number.isFinite(row.size)) throw new BundleError('Invalid bundle paths. All files were kept.');
      if (!containedRelative(row.stored, directory) || !containedRelative(row.original, checked(manifest.jsonFile).root)) throw new BundleError('Trash manifest escapes its original root.');
      checked(row.stored); checked(row.original);
      if(!same(checked(row.stored).path,row.stored))throw new BundleError('A saved bundle file redirects elsewhere. All files were kept.');
    }
    return { directory, manifest };
  }
  return null;
}
/** Copy, verify all bytes, then remove sources. Never overwrite a destination. */
export async function transferBundle(pairs: { source: string; destination: string }[], inject?: (phase: 'copy' | 'remove', index: number) => void) {
  const copied: typeof pairs = [], removed: typeof pairs = [];
  const expected=new Map<string,string>();
  try {
    for (const [index, row] of pairs.entries()) {
      checked(row.source); checked(row.destination);
      inject?.('copy', index);
      fs.mkdirSync(path.dirname(row.destination), { recursive: true });
      const before = await hash(row.source);
      expected.set(row.source,before);
      await fs.promises.copyFile(row.source, row.destination, fs.constants.COPYFILE_EXCL); copied.push(row);
      if (await hash(row.destination) !== before || await hash(row.source) !== before) throw new BundleError('A file changed while moving. No successful move was acknowledged.');
    }
    for (const [index, row] of pairs.entries()) { inject?.('remove', index); if (await hash(row.source) !== expected.get(row.source) || await hash(row.destination) !== expected.get(row.source)) throw new BundleError('A source or destination changed before removal. Its current bytes were kept.'); await fs.promises.unlink(row.source); removed.push(row); }
    for(const row of pairs)if(await hash(row.destination)!==expected.get(row.source))throw new BundleError('A destination changed before acknowledgment. Review the retained files.');
  } catch (error) {
    const remaining: { original: string; backup: string; error: string }[] = [];
    for (const row of removed.reverse()) {
      try { if(await hash(row.destination)!==expected.get(row.source))throw new Error('Backup changed; original could not be safely restored.');await fs.promises.copyFile(row.destination, row.source, fs.constants.COPYFILE_EXCL); }
      catch (restoreError) { remaining.push({ original: row.source, backup: row.destination, error: String(restoreError) }); }
    }
    if (!remaining.length) {
      for (const row of copied) { try { if (fs.existsSync(row.source) && await hash(row.source) === await hash(row.destination)) await fs.promises.unlink(row.destination); } catch { /* Keep a backup whenever its integrity is uncertain. */ } }
    }
    for(const row of copied) if(fs.existsSync(row.destination) && !remaining.some(saved=>saved.backup===row.destination)) remaining.push({original:row.source,backup:row.destination,error:'Retained copy needs review; original bytes differ or could not be verified.'});
    throw new BundleError(error instanceof Error ? error.message : String(error), { recoveryNeeded: remaining });
  }
}
export async function moveToTrash(jsonFile: string, requestId = randomUUID()) {
  const previous = locate(requestId);
  if (previous) {
    if (!same(previous.manifest.jsonFile, jsonFile)) throw new BundleError('This removal receipt belongs to another entry.');
    if (previous.manifest.state === 'trashed') return { ok: true, trashId: requestId, entryId: previous.manifest.entryId, jsonFile: previous.manifest.jsonFile };
    if (previous.manifest.state !== 'rolled_back') throw new BundleError('This removal needs recovery. Open Trash to inspect the saved bundle.', { trashId: requestId });
  }
  const allowed = entryPath(jsonFile), files = entryBundleFiles(allowed.path);
  const directory = ownedTrashDirectory(allowed.root,requestId);
  return withEntryOperation(files, async () => {
    const json = JSON.parse(fs.readFileSync(allowed.path, 'utf8')) as TranscriptionDocument;
    ensureEntryId(json); writeEntryJson(allowed.path, JSON.stringify(json, null, 2));
    const manifest: Manifest = { version: 1, id: requestId, entryId: json.entryId!, jsonFile: allowed.path, title: json.displayTitle || path.basename(allowed.path), deletedAt: new Date().toISOString(), state: 'preparing', files: files.map((original, i) => ({ original, stored: path.join(directory, `file-${i}${path.extname(original)}`), size: fs.statSync(original).size })) };
    writeManifest(directory, manifest);
    try {
      for (const row of manifest.files) row.hash = await hash(row.original);
      writeManifest(directory, manifest);
      await transferBundle(manifest.files.map(row => ({ source: row.original, destination: row.stored })));
      manifest.state = 'trashed'; writeManifest(directory, manifest);
      getJournalIndex()?.removeSidecar(allowed.path); forgetTranscription(allowed.path); emitNotesIndex();
      return { ok: true, trashId: requestId, entryId: manifest.entryId, jsonFile: allowed.path };
    } catch (error) {
      manifest.state = manifest.files.every(row => fs.existsSync(row.original) && !fs.existsSync(row.stored)) ? 'rolled_back' : 'recovery_needed'; manifest.error = error instanceof Error ? error.message : String(error);
      try { writeManifest(directory, manifest); } catch { /* Preserve the original preparing manifest and any copied bytes. */ }
      throw new BundleError(manifest.error, { trashId: requestId, recovery: error instanceof BundleError ? error.details : undefined });
    }
  });
}
function alternatePath(jsonFile: string, collision: (base: string) => boolean) {
  const parsed = path.parse(jsonFile);
  for (let n = 2; n < 10000; n++) { const candidate = path.join(parsed.dir, `${parsed.name}-${n}.json`); if (!collision(candidate)) return candidate; }
  throw new BundleError('Could not reserve a Keep both filename.');
}
const remap = (original: string, oldJson: string, newJson: string) => newJson.replace(/\.json$/i, '') + original.slice(oldJson.replace(/\.json$/i, '').length);
export function listTrash() {
  const result: Record<string, unknown>[] = [];
  for (const root of [...new Set(allowedRoots())]) {
    const base = ownedTrashDirectory(root);
    if (!fs.existsSync(base)) continue;
    for (const row of fs.readdirSync(base, { withFileTypes: true })) {
      if (!row.isDirectory() || !ID.test(row.name)) continue;
      try { const saved = locate(row.name); if (!saved || ['restored','rolled_back'].includes(saved.manifest.state)) continue; const m = saved.manifest;
        result.push({ id: m.id, entryId: m.entryId, title: m.title, deletedAt: m.deletedAt, state: ['preparing','restoring'].includes(m.state) ? 'recovery_needed' : m.state, originalJsonFile: m.jsonFile, fileCount: m.files.length, bytes: m.files.reduce((sum, file) => sum + file.size, 0), error: m.error });
      } catch(error) { result.push({ id: row.name, state: 'recovery_needed', title: 'Unreadable Trash manifest', error: String(error) }); }
    }
  }
  return result.sort((a,b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}
export function previewRestore(id: string, keepBoth = true) {
  const saved = locate(id); if (!saved) throw new BundleError('Trash bundle not found.');
  const m = saved.manifest;
  if (m.state !== 'trashed') throw new BundleError('This bundle needs recovery before a normal restore.', { state: m.state, trashId: id });
  const conflicts = m.files.filter(row => fs.existsSync(row.original)).map(row => row.original);
  let jsonFile = m.jsonFile;
  if (conflicts.length && keepBoth) jsonFile = alternatePath(m.jsonFile, base => m.files.some(row => fs.existsSync(remap(row.original, m.jsonFile, base))));
  return { id, entryId: m.entryId, originalJsonFile: m.jsonFile, jsonFile, conflicts, keepBoth };
}
export async function restoreTrash(id: string, keepBoth = true) {
  const saved = locate(id); if (!saved) throw new BundleError('Trash bundle not found.');
  if (saved.manifest.state === 'restored') return { ok: true, ...readTranscription(saved.manifest.restoredJsonFile!), entryId: saved.manifest.entryId };
  const preview = previewRestore(id, keepBoth), m = saved.manifest;
  if (preview.conflicts.length && !keepBoth) throw new BundleError('Restore destination exists. Choose Keep both; existing files are preserved.', preview);
  const pairs = m.files.map(row => ({ source: row.stored, destination: remap(row.original, m.jsonFile, preview.jsonFile) }));
  return withEntryOperation(pairs.flatMap(row => [row.source, row.destination]), async () => {
    for (const row of m.files) if (!row.hash || !fs.existsSync(row.stored) || await hash(row.stored) !== row.hash) throw new BundleError('A saved bundle file is missing or changed. Restore was not acknowledged.');
    m.state = 'restoring'; m.restoredJsonFile = preview.jsonFile; writeManifest(saved.directory, m);
    try { await transferBundle(pairs); m.state = 'restored'; m.restoredJsonFile = preview.jsonFile; writeManifest(saved.directory, m);
      relocateTranscription(m.jsonFile, preview.jsonFile); emitNotesIndex();
      return { ok: true, ...readTranscription(preview.jsonFile), entryId: m.entryId, conflicts: preview.conflicts };
    } catch(error) { m.state = m.files.every(row=>fs.existsSync(row.stored)) && pairs.every(row=>!fs.existsSync(row.destination)) ? 'trashed' : 'recovery_needed'; m.error = String(error); try { writeManifest(saved.directory,m); } catch {} throw new BundleError(String(error), { trashId: id }); }
  });
}
export function purgeTrash(id: string, confirmation: unknown) {
  if (confirmation !== 'DELETE AUDIO AND TRANSCRIPT') throw new BundleError('Confirm permanent deletion of audio and transcript data.');
  const saved = locate(id); if (!saved) throw new BundleError('Trash bundle not found.');
  if (saved.manifest.state !== 'trashed') throw new BundleError('Only a fully acknowledged Trash bundle can be permanently deleted. Recovery bundles are kept.');
  saved.manifest.files.forEach(row => { assertEntryWritable(row.original); assertEntryWritable(row.stored); });
  checked(saved.directory); fs.rmSync(saved.directory, { recursive: true }); return { ok: true, id };
}
/** Reconcile interrupted receipts only when every retained byte is accounted for. */
export async function recoverTrash(id: string) {
  const saved=locate(id); if(!saved)throw new BundleError('Trash bundle not found.');
  const m=saved.manifest;
  return withEntryOperation(m.files.flatMap(row=>[row.original,row.stored]),async()=>{
    const inspected=[];
    for(const row of m.files){
      const destination=m.restoredJsonFile ? remap(row.original,m.jsonFile,m.restoredJsonFile) : row.original;
      const stored=fs.existsSync(row.stored)&&Boolean(row.hash)&&await hash(row.stored)===row.hash;
      const original=fs.existsSync(destination)&&Boolean(row.hash)&&await hash(destination)===row.hash;
      inspected.push({row,destination,stored,original});
    }
    if(inspected.every(row=>row.original)&&m.restoredJsonFile){
      m.state='restored'; writeManifest(saved.directory,m); relocateTranscription(m.jsonFile,m.restoredJsonFile);emitNotesIndex();
      return {ok:true,state:m.state,...readTranscription(m.restoredJsonFile)};
    }
    if(inspected.every(row=>row.original)&&!m.files.some(row=>fs.existsSync(row.stored))){
      m.state='rolled_back';writeManifest(saved.directory,m);return {ok:true,state:m.state,...readTranscription(m.jsonFile)};
    }
    if(inspected.every(row=>row.stored)&&!inspected.some(row=>row.original)){
      m.state='trashed';writeManifest(saved.directory,m);forgetTranscription(m.jsonFile);emitNotesIndex();return {ok:true,state:m.state};
    }
    throw new BundleError('Some paths are missing or differ from the saved manifest. All retained copies were kept; inspect the listed paths before resolving the conflict.',{trashId:id,files:inspected.map(row=>({original:row.destination,backup:row.row.stored,originalIntact:row.original,backupIntact:row.stored}))});
  });
}
export async function moveEntryBundle(jsonFile: string, destination: string, mutate?: (json: TranscriptionDocument) => void, allowWaiting = false) {
  const allowed = entryPath(jsonFile,allowWaiting), files = entryBundleFiles(allowed.path,allowWaiting), target = checked(destination);
  if (isSkippedWatchPath(target.path) || !/\.json$/i.test(target.path) || target.root !== allowed.root) throw new BundleError('Move destination must be an entry path in the same configured root.');
  const pairs = files.map(source => ({ source, destination: remap(source, allowed.path, target.path) }));
  return withEntryOperation([...files,...pairs.map(row=>row.destination)], async () => {
    const original = fs.readFileSync(allowed.path,'utf8'), json = JSON.parse(original) as TranscriptionDocument;
    ensureEntryId(json); mutate?.(json); const updated = JSON.stringify(json,null,2); writeEntryJson(allowed.path,updated);
    try { if (!same(allowed.path,target.path)) await transferBundle(pairs);
      relocateTranscription(allowed.path,target.path); activity.relocate(allowed.path,target.path); emitNotesIndex();
      const note=readTranscription(target.path);if(!note)throw new BundleError('Moved transcript could not be read.');
      return { ok:true, oldJsonFile:allowed.path, ...note, entryId:json.entryId };
    } catch(error) {
      if(!same(allowed.path,target.path) && pairs.every(row=>!fs.existsSync(row.source)&&fs.existsSync(row.destination))) {
        try { await transferBundle(pairs.map(row=>({source:row.destination,destination:row.source}))); }
        catch(rollback) { throw new BundleError('Move was not acknowledged; some files remain at the destination. All retained copies were kept.',{files:pairs.map(row=>({original:row.source,destination:row.destination,originalExists:fs.existsSync(row.source),destinationExists:fs.existsSync(row.destination)})),cause:String(rollback)}); }
      }
      if(fs.existsSync(allowed.path) && fs.readFileSync(allowed.path,'utf8') === updated) writeEntryJson(allowed.path,original);
      throw error;
    }
  });
}
export function keepBothDestination(jsonFile: string, target: string, allowWaiting = false) {
  const files=entryBundleFiles(jsonFile,allowWaiting);
  return files.some(file=>fs.existsSync(remap(file,jsonFile,target))) ? alternatePath(target,base=>files.some(file=>fs.existsSync(remap(file,jsonFile,base)))) : target;
}
