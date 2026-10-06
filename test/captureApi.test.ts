import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.ts';
import { apiRoutes } from '../src/apiRoutes.ts';
import { ActivityStore, activity, setActivityStore } from '../src/lib/activityLib.ts';
import { initQueues, q } from '../src/lib/queueLib.ts';
import { process as processAudio, requestCleanup } from '../src/lib/transcriptionLib.ts';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-capture-api-'));
config.watch.roots=[];config.watch.browserDropFolder=root;config.journal.index=path.join(root,'journal.sqlite');config.ollanet.machine='fixture';config.ollanet.cleanModel='fixture';
setActivityStore(new ActivityStore(path.join(root,'.dictawhisper','activity.json')));
const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
const stable=(file:string)=>{const old=new Date(Date.now()-5000);fs.utimesSync(file,old,old);};
test('real multipart route acknowledges Saved and reconciles repeated upload IDs without duplicate files',async()=>{
  const app=express();app.use(express.json());for(const route of apiRoutes.filter(r=>r.path.startsWith('/audio') || r.path.startsWith('/notes/activity'))) app[route.method==='POST'?'post':'get'](route.path,route.handler);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
  const send=(bytes:Buffer,name='same.wav',id='upload-12345')=>{const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)]),name);form.append('uploadId',id);return fetch(base+'/audio',{method:'POST',body:form});};
  try {
    const replies=await Promise.all([send(wav),send(wav)]);assert.deepEqual(replies.map(r=>r.status),[202,202]);const [one,two]=await Promise.all(replies.map(r=>r.json()));assert.equal(one.saved,true);assert.equal(one.file,two.file);assert.equal(one.item.id,two.item.id);
    const receipt=await (await fetch(base+'/audio/upload?uploadId=upload-12345')).json();assert.equal(receipt.found,true);assert.equal(receipt.item.id,one.item.id);
    assert.equal(fs.readdirSync(root).filter(f=>f.endsWith('.wav')).length,1);
    const bad=await send(Buffer.from('plain text'),'disguised.wav','upload-invalid');assert.equal(bad.status,400);assert.match((await bad.json()).error,/Unsupported/);
    const unsafe=await fetch(base+'/notes/activity/process-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:one.item.id})});assert.equal(unsafe.status,409);
    stable(one.file);await processAudio(one.file,{force:true});assert.equal(activity.byId(one.item.id)?.stage,'queued_transcription');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('actual pipeline emits truthful stage order, deduplicates transcription and cleanup, and retains Original on cleanup failure',{timeout:5000},async()=>{
  let finish:any,transcribed=0,cleaned=0,cleanupDone:any;const completion=()=>new Promise<void>(resolve=>cleanupDone=resolve);const events:any[]=[];activity.setEmitter(e=>events.push(e));
  initQueues({transcription:{active:true,concurrency:1,processor:(task,cb)=>{transcribed++;finish=()=>{fs.writeFileSync(task.transcriptionFile,JSON.stringify({text:'Original',displayTitle:'Human title',starred:true}));cb({err:null,result:{elapsed:'1s'}});};}},processing:{active:true,concurrency:1,processor:(_task,cb)=>{cleaned++;setTimeout(()=>{cb(new Error('Cleanup fixture offline'));cleanupDone();},10);}}});
  const file=path.join(root,'pipeline.wav');fs.writeFileSync(file,wav);stable(file);activity.update(file,'waiting_for_file',{originalName:'original-file.webm'});
  await processAudio(file,{force:true});await processAudio(file,{retry:true});await new Promise(r=>setImmediate(r));assert.equal(transcribed,1);const firstDone=completion();finish();
  await firstDone;const item=activity.find(file)!;assert.equal(item.stage,'failed_cleanup');assert.equal(item.hasTranscript,true);assert.equal(cleaned,1);
  assert.deepEqual(events.filter(e=>e.item.audioFile===file).map(e=>e.item.stage),['waiting_for_file','queued_transcription','transcribing','queued_cleanup','cleaning','failed_cleanup']);
  const jsonFile=file.replace('.wav','.json');const json=JSON.parse(fs.readFileSync(jsonFile,'utf8'));assert.equal(json.text,'Original');assert.equal(json.displayTitle,'Human title');assert.equal(json.starred,true);assert.equal(json.originalFilename,'original-file.webm');
  const secondDone=completion();requestCleanup(jsonFile);requestCleanup(jsonFile);await secondDone;assert.equal(transcribed,1);assert.equal(cleaned,2);assert.equal(JSON.parse(fs.readFileSync(jsonFile,'utf8')).text,'Original');assert.equal(q.processing.running(),0);
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
