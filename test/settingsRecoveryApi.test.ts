import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import {config} from '../src/config.ts';
import {effectiveSettings} from '../src/lib/settingsLib.ts';
import {apiRoutes} from '../src/apiRoutes.ts';
import {ActivityStore,setActivityStore} from '../src/lib/activityLib.ts';
import {JournalIndex,setJournalIndex} from '../src/lib/journalIndexLib.ts';
import {getProbeJob,startProbeJob,markReviewedAudio} from '../src/lib/audioProbeLib.ts';
import {applyConsolidateGroups,buildConsolidatePlan} from '../src/lib/tagConsolidateLib.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-settings-'));
config.watch.roots=[root,path.join(root,'missing')];config.watch.browserDropFolder=path.join(root,'captures');config.journal.index=path.join(root,'index.sqlite');config.journal.search='lex';config.http.tailscale=false;config.ollanet.machine='';config.ollanet.cleanModel='';
const index=new JournalIndex(config.journal.index);setJournalIndex(index);setActivityStore(new ActivityStore(path.join(root,'.dictawhisper','activity.json')));
test('effective settings are read-only, reflect runtime values and readiness, contain executable MCP config, and do not create missing folders',()=>{
 const before=fs.readdirSync(root);const data=effectiveSettings();assert.equal(data.readOnly,true);assert.equal(data.folders.roots[1].exists,false);assert.equal(fs.existsSync(data.folders.browserDropFolder),false);assert.deepEqual(fs.readdirSync(root),before);assert.equal(data.cleanup.available,false);assert.equal(data.network.port,config.http.port);assert.equal(data.integrations.mcp.command,process.execPath);assert.ok(fs.existsSync(data.integrations.mcp.args.at(-1)!));assert.match(data.integrations.exoMetaCortex,/Not connected/);assert.ok(!JSON.stringify(data).includes('transcriptionJson'));
});
test('real HTTP recovery contracts validate input, acknowledge durable Trash and restore, gate replacement, and rebuild cache without models',async()=>{
 const app=express();app.use(express.json());for(const route of apiRoutes.filter(route=>route.path.startsWith('/notes/trash')||route.path.startsWith('/notes/organization')||['/settings','/tools/index/rebuild','/tools/entries/identity'].includes(route.path)))app[route.method==='POST'?'post':'get'](route.path,route.handler);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const post=(route:string,body:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
 const file=path.join(root,'entry.json');fs.writeFileSync(file,JSON.stringify({text:'API recovery speech'}));fs.writeFileSync(file.replace('.json','.wav'),'audio');index.upsertSidecar(file);
 assert.equal((await fetch(base+'/settings')).status,200);assert.equal((await post('/notes/trash/remove',{file:path.join(os.tmpdir(),'elsewhere.json')})).status,409);
 const response=await post('/notes/trash/remove',{file,requestId:'test-api-receipt-123456'});assert.equal(response.status,200);const receipt=await response.json();assert.ok(receipt.entryId);assert.equal(fs.existsSync(file),false);assert.equal((await(await fetch(base+'/notes/trash')).json()).items.length,1);
 assert.equal((await post('/notes/trash/purge',{id:receipt.trashId})).status,409);
 assert.equal((await post('/notes/trash/restore',{id:receipt.trashId})).status,200);assert.equal(fs.existsSync(file),true);
 assert.equal((await post('/notes/organization/apply',{file,date:'2026-10-05',action:'replace'})).status,409);assert.equal(fs.existsSync(file),true);
 const preview=await(await post('/notes/organization/preview',{file,date:'2026-10-05'})).json();assert.ok(preview.fingerprint);assert.equal((await post('/notes/organization/apply',{file,date:'2026-10-05',fingerprint:preview.fingerprint})).status,200);
 const rebuild=await(await post('/tools/index/rebuild',{})).json();assert.equal(rebuild.ok,true);assert.equal(rebuild.embedded,0);assert.equal(index.list({all:true}).length,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test.after(()=>{setJournalIndex(null);index.close();fs.rmSync(root,{recursive:true,force:true});});
test('reviewed marking rejects unscanned files before changing any sidecars and retains all audio bytes',async()=>{
 const folder=path.join(root,'probe');fs.mkdirSync(folder);const file=path.join(folder,'empty.wav');fs.writeFileSync(file,Buffer.alloc(0));startProbeJob([folder],{apply:false});while(getProbeJob().running)await new Promise(r=>setTimeout(r,10));
 await assert.rejects(markReviewedAudio([file,path.join(root,'unscanned.wav')]),/current check-only/);assert.equal(fs.existsSync(file.replace('.wav','.json')),false);
 const result=await markReviewedAudio([file]);assert.equal(result.marked,1);assert.equal(fs.existsSync(file),true);assert.equal(fs.statSync(file).size,0);assert.match(JSON.parse(fs.readFileSync(file.replace('.wav','.json'),'utf8')).audioError,/unreadable/);
});
test('tag maintenance counts indexed entries, rereads human metadata, and acknowledges changed entries',async()=>{
 const file=path.join(root,'tag-maintenance.json');fs.writeFileSync(file,JSON.stringify({text:'Speech',tags:['home-repairs','home-repair'],displayTitle:'Keep human title',entryId:'stable-fixture-id',starred:true,mayDos:[{id:'decided',status:'selected'}]}));index.upsertSidecar(file);
 const plan=await buildConsolidatePlan({useModel:false});assert.ok(plan.groups.some(group=>group.affectedEntries===1));
 const latest=JSON.parse(fs.readFileSync(file,'utf8'));latest.displayTitle='Updated elsewhere';fs.writeFileSync(file,JSON.stringify(latest));const result=applyConsolidateGroups([{keep:'home-repair',drop:['home-repairs']}]);assert.equal(result.filesChanged,1);assert.equal(result.failed,0);const json=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(json.displayTitle,'Updated elsewhere');assert.equal(json.entryId,'stable-fixture-id');assert.equal(json.starred,true);assert.equal(json.mayDos[0].status,'selected');assert.deepEqual(json.tags,['home-repair']);assert.ok(json.tagsEditedAt);
});
