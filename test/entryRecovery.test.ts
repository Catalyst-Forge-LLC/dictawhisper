import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {config} from '../src/config.ts';
import {JournalIndex,setJournalIndex} from '../src/lib/journalIndexLib.ts';
import {ActivityStore,setActivityStore} from '../src/lib/activityLib.ts';
import {entryBundleFiles,moveEntryBundle,moveToTrash,restoreTrash,previewRestore,listTrash,purgeTrash,transferBundle,recoverTrash} from '../src/lib/entryBundleLib.ts';
import {organizationPreview,organizeEntry} from '../src/lib/entryOrganizationLib.ts';
import {backfillEntryIds} from '../src/lib/entryIdentityLib.ts';
import {withEntryOperation} from '../src/lib/entryOperationLib.ts';
import {patchTranscription} from '../src/lib/transcriptionLib.ts';
import {preserveHumanEdits} from '../src/lib/humanEditsLib.ts';
import {resolveAllowedPath} from '../src/lib/pathAllowLib.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-recovery-'));
config.watch.roots=[root];config.watch.browserDropFolder=root;config.journal.index=path.join(root,'journal.sqlite');
config.journal.search='lex';config.journal.embedModel='';config.ollanet.machine='';
const index=new JournalIndex(config.journal.index);setJournalIndex(index);setActivityStore(new ActivityStore(path.join(root,'.dictawhisper','activity.json')));
function entry(name:string,text='Speech'){const file=path.join(root,name+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({text,displayTitle:name,starred:true,tags:['human']}));for(const suffix of ['.wav','_original.mp3','_clean.ogg'])fs.writeFileSync(file.slice(0,-5)+suffix,Buffer.from('audio:'+suffix+':'+text));index.upsertSidecar(file);return file;}
test('Trash acknowledgment retains every variant, idempotent receipts, excluded index, collision Keep both and byte-identical restore',async()=>{
 const file=entry('2026/09/2026-09-01_A'),originals=entryBundleFiles(file).map(file=>({file,bytes:fs.readFileSync(file)}));
 const receipt=await moveToTrash(file);assert.ok(receipt.entryId);assert.equal(entryBundleFiles.bind(null,file) instanceof Function,true);assert.ok(originals.every(row=>!fs.existsSync(row.file)));assert.equal(index.list({all:true}).length,0);assert.equal(listTrash().length,1);assert.equal((await moveToTrash(file,receipt.trashId)).trashId,receipt.trashId);
 entry('2026/09/2026-09-01_A','Newer');const preview=previewRestore(receipt.trashId);assert.equal(preview.conflicts.length,4);assert.match(preview.jsonFile,/-2\.json$/);await assert.rejects(restoreTrash(receipt.trashId,false),/destination exists/);
 const restored=await restoreTrash(receipt.trashId);assert.equal(restored.entryId,receipt.entryId);for(const row of originals.slice(1))assert.deepEqual(fs.readFileSync(restored.jsonFile.slice(0,-5)+row.file.slice(file.length-5)),row.bytes);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).text,'Newer');assert.equal(listTrash().length,0);
 assert.equal((await restoreTrash(receipt.trashId)).jsonFile,restored.jsonFile);
});
test('copy and removal failures rollback all original bytes; external changed source is retained',async()=>{
 for(const phase of ['copy','remove'] as const){const source=entry(`failure-${phase}`),files=entryBundleFiles(source),before=files.map(f=>fs.readFileSync(f)),pairs=files.map((source,i)=>({source,destination:path.join(root,`target-${phase}`,`part-${i}`)}));await assert.rejects(transferBundle(pairs,(p,i)=>{if(p===phase&&i===2)throw new Error('Injected failure');}),/Injected/);files.forEach((f,i)=>assert.deepEqual(fs.readFileSync(f),before[i]));assert.ok(pairs.every(p=>!fs.existsSync(p.destination)));}
 const source=entry('changed');const destination=path.join(root,'changed-copy.json');await assert.rejects(transferBundle([{source,destination}],(phase)=>{if(phase==='remove')fs.writeFileSync(source,'external new bytes');}),/changed/);assert.equal(fs.readFileSync(source,'utf8'),'external new bytes');assert.ok(fs.existsSync(destination));
});
test('changed saved bytes block restore; recovery keeps uncertain copies and purge requires explicit audio/transcript confirmation',async()=>{
 const receipt=await moveToTrash(entry('corrupt'));const dir=path.join(root,'.dictawhisper','trash',receipt.trashId);fs.writeFileSync(path.join(dir,'file-1.wav'),'changed backup');await assert.rejects(restoreTrash(receipt.trashId),/changed/);await assert.rejects(recoverTrash(receipt.trashId),/retained copies/);assert.ok(fs.existsSync(path.join(dir,'file-1.wav')));assert.throws(()=>purgeTrash(receipt.trashId,''),/Confirm/);
 const good=await moveToTrash(entry('purge'));entry('purge','new original');purgeTrash(good.trashId,'DELETE AUDIO AND TRANSCRIPT');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'purge.json'),'utf8')).text,'new original');
});
test('explicit identity backfill and confirmed date move preserve identity and human metadata',async()=>{
 const file=entry('_unfiled/undated');const result=backfillEntryIds();assert.ok(result.assigned>0);const id=JSON.parse(fs.readFileSync(file,'utf8')).entryId;assert.equal(backfillEntryIds().assigned,0);
 const preview=organizationPreview(file,'2010-11-17');const moved=await organizeEntry(file,{date:'2010-11-17',fingerprint:preview.fingerprint});assert.ok('jsonFile'in moved);if(!('jsonFile'in moved))return;const json=JSON.parse(fs.readFileSync(moved.jsonFile,'utf8'));assert.equal(json.entryId,id);assert.equal(json.recordedAtSource,'user');assert.equal(json.recordedDate,'2010-11-17');assert.equal(entryBundleFiles(moved.jsonFile).length,4);assert.ok(index.list({all:true}).some(n=>n.entryId===id));
 const cleaned:any={text:'New cleanup'};preserveHumanEdits(cleaned,json,json);assert.equal(cleaned.entryId,id);assert.equal(cleaned.recordedDate,'2010-11-17');
});
test('replacement has a recoverable existing bundle and stale previews cannot move files',async()=>{
 const existing=entry('2026/10/2026-10-01_duplicate','Existing'),incoming=entry('_holding/2026-10-01_duplicate','Incoming');const preview=organizationPreview(incoming);await assert.rejects(organizeEntry(incoming,{action:'replace',fingerprint:preview.fingerprint}),/confirmation/);
 fs.appendFileSync(incoming,' ');await assert.rejects(organizeEntry(incoming,{fingerprint:preview.fingerprint}),/changed since/);const refreshed=organizationPreview(incoming);const result=await organizeEntry(incoming,{action:'replace',confirmed:true,fingerprint:refreshed.fingerprint});assert.ok('backupId'in result && result.backupId);assert.equal(JSON.parse(fs.readFileSync(existing,'utf8')).text,'Incoming');if('backupId'in result&&result.backupId){const recovered=await restoreTrash(result.backupId);assert.equal(JSON.parse(fs.readFileSync(recovered.jsonFile,'utf8')).text,'Existing');}
});
test('entry writes are locked during bundle moves and invalid restore IDs cannot escape root',async()=>{
 const file=entry('locked');await withEntryOperation([file],async()=>{assert.throws(()=>patchTranscription(file,{starred:false}),/being moved/);});assert.throws(()=>previewRestore('../../elsewhere'),/Invalid/);
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-outside-'));try{const link=path.join(root,'junction');fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');assert.equal(resolveAllowedPath(path.join(link,'new','file.json')).ok,false);}finally{fs.rmSync(outside,{recursive:true,force:true});}
});
test('failed index reconciliation rolls the bundle and metadata back; conditional tag Undo preserves newer edits',async()=>{
 const file=entry('index-failure'),before=entryBundleFiles(file).map(file=>({file,bytes:fs.readFileSync(file)})),original=index.relocateSidecar;
 index.relocateSidecar=()=>{throw new Error('Index unavailable');};
 try{await assert.rejects(moveEntryBundle(file,path.join(root,'elsewhere','moved.json'),json=>json.recordedDate='2001-01-01'),/Index unavailable/);for(const row of before)assert.deepEqual(fs.readFileSync(row.file),row.bytes);}
 finally{index.relocateSidecar=original;}
 patchTranscription(file,{tags:['changed']});assert.throws(()=>patchTranscription(file,{tags:['human'],expectedTags:['previous']}),/changed elsewhere/);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).tags,['changed']);
});
test('a redirected Trash directory cannot turn permanent deletion into removal of a configured root',()=>{
 const id='redirected-trash-123456';const link=path.join(root,'.dictawhisper','trash',id);fs.symlinkSync(root,link,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>purgeTrash(id,'DELETE AUDIO AND TRANSCRIPT'),/redirects/);assert.ok(fs.existsSync(config.journal.index));
 fs.unlinkSync(link);
});
test.after(()=>{setJournalIndex(null);index.close();fs.rmSync(root,{recursive:true,force:true});});
