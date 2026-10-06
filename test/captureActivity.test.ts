import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityStore } from '../src/lib/activityLib.ts';
import { saveUploadedAudio, MAX_UPLOAD_BYTES } from '../src/lib/audioLib.ts';
import { inspectFileReadiness, requestWhenSettled, isSkippedWatchPath } from '../src/lib/fileSettleLib.ts';
import { createCaptureSession, createImportQueue, microphoneFailure } from '../client/src/lib/captureSession.js';
import { mergeActivity } from '../client/src/lib/activityState.js';

const turn = () => new Promise(resolve=>setImmediate(resolve));
function hardware() {
  let stopped=0, requested=0;
  class Recorder {
    state='inactive'; mimeType='audio/wav'; onstop:any; ondataavailable:any;
    constructor(_stream:any) {}
    start(){this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['audio'],{type:this.mimeType})});this.onstop?.();});}
  }
  return { Recorder, media:{getUserMedia:async()=>{requested++;return {getTracks:()=>[{stop:()=>stopped++}]};}}, stats:()=>({stopped,requested}) };
}
test('record permission is explicit; Stop retains draft; failed Save retries the same bytes; teardown never saves',async()=>{
  const h=hardware();const session=createCaptureSession(h);let uploads=0;
  assert.equal(h.stats().requested,0);
  await session.start();assert.equal(session.state.phase,'recording');
  session.stop();await turn();assert.equal(session.state.phase,'draft');assert.equal(uploads,0);assert.equal(h.stats().stopped,1);
  const draft=session.state.draft;
  await session.save(async blob=>{uploads++;assert.equal(blob,draft);throw new Error('Connection lost');});
  assert.equal(session.state.draft,draft);assert.match(session.state.error,/Connection lost/);
  await session.save(async blob=>{uploads++;assert.equal(blob,draft);return {saved:true,file:'saved.wav'};});
  assert.equal(session.state.phase,'accepted');assert.equal(session.state.draft,null);assert.equal(uploads,2);
  await session.start();session.destroy();await turn();assert.equal(h.stats().stopped,2);assert.equal(uploads,2);
});
test('Discard and late permission resolution release hardware without producing a draft',async()=>{
  const h=hardware();const session=createCaptureSession(h);await session.start();session.discard();await turn();assert.equal(session.state.draft,null);assert.equal(session.state.phase,'idle');assert.equal(h.stats().stopped,1);
  let grant:any;let stopped=0;const late=createCaptureSession({Recorder:h.Recorder,media:{getUserMedia:()=>new Promise(resolve=>grant=resolve)}});const starting=late.start();late.destroy();grant({getTracks:()=>[{stop:()=>stopped++}]});await starting;assert.equal(stopped,1);assert.equal(late.state.draft,null);
});
test('denied, absent, busy, insecure and unsupported microphones explain the available Import recovery',async()=>{
  for(const name of ['NotAllowedError','NotFoundError','NotReadableError']){
    const session=createCaptureSession({media:{getUserMedia:async()=>{throw Object.assign(new Error('failure'),{name});}},Recorder:hardware().Recorder});await session.start();assert.equal(session.state.phase,'idle');assert.match(session.state.error,/import audio/i);
  }
  assert.match(microphoneFailure({},false),/HTTPS or localhost/);
  const missing=createCaptureSession();await missing.start();assert.match(missing.state.error,/does not support/);
});
test('unacknowledged Save keeps draft, and concurrent Save joins rather than submitting twice',async()=>{
  const session=createCaptureSession(hardware());await session.start();session.stop();await turn();let resolve:any,calls=0;
  const saving=session.save(()=>{calls++;return new Promise(r=>resolve=r);});await session.save(()=>{calls++;});assert.equal(calls,1);resolve({ok:true});await saving;assert.equal(session.state.phase,'draft');assert.ok(session.state.draft);assert.match(session.state.error,/acknowledge/);
});
test('cancelling an outstanding permission request prevents late recording startup',async()=>{
  let grant:any,stopped=0;const session=createCaptureSession({Recorder:hardware().Recorder,media:{getUserMedia:()=>new Promise(resolve=>grant=resolve)}});const starting=session.start();session.discard();grant({getTracks:()=>[{stop:()=>stopped++}]});await starting;assert.equal(stopped,1);assert.equal(session.state.phase,'idle');assert.equal(session.state.draft,null);
});
test('audio conversion keeps Activity identity and internal history stays outside the journal',()=>{
  const store=new ActivityStore();const file=path.resolve('converted.wav');const first=store.update(file,'transcribing',{uploadId:'upload-converted'});store.update(first.jsonFile,'transcribing',{audioFile:path.resolve('converted.mp3')});const done=store.update(file,'ready',{hasTranscript:true});assert.equal(done.id,first.id);assert.equal(done.audioFile,path.resolve('converted.mp3'));assert.equal(store.snapshot().items.length,1);assert.equal(isSkippedWatchPath(path.resolve('.dictawhisper/activity.json')),true);
});
test('mixed imports run only two requests; failures retain source and retry the same upload identity',async()=>{
  let rows:any[]=[],next=0,max=0,active=0;const jobs:any[]=[];const ids:string[]=[];
  const queue=createImportQueue({capabilities:()=>({formats:['wav'],maxBytes:100}),id:()=>`upload-${++next}`,onChange:r=>rows=r,upload:(file,id)=>{ids.push(id);active++;max=Math.max(max,active);return new Promise((resolve,reject)=>jobs.push({file,resolve:(v:any)=>{active--;resolve(v);},reject:(e:any)=>{active--;reject(e);}}));}});
  queue.add([{name:'one.wav',size:10},{name:'two.wav',size:10},{name:'three.wav',size:10},{name:'wrong.txt',size:10},{name:'empty.wav',size:0},{name:'large.wav',size:101}]);await turn();assert.equal(jobs.length,2);assert.equal(rows.filter(r=>r.state==='failed').length,3);
  jobs[0].resolve({saved:true,file:'one.wav'});jobs[1].reject(new Error('response lost'));await turn();assert.equal(jobs.length,3);assert.equal(rows[1].file.name,'two.wav');
  queue.retry('upload-2');await turn();assert.deepEqual(ids,['upload-1','upload-2','upload-3','upload-2']);assert.equal(max,2);
  jobs[2].resolve({saved:true,file:'three.wav'});jobs[3].resolve({saved:true,file:'two.wav'});await turn();assert.equal(rows[1].file,null);assert.equal(rows[1].state,'saved');queue.destroy();
});
test('Activity restart marks unfinished work interrupted without replay; receipts and identities survive relocation',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-activity-test-'));try{
    const file=path.join(root,'activity.json'), store=new ActivityStore(file);const events:any[]=[];store.setEmitter(e=>events.push(e));
    const first=store.update(path.join(root,'one.wav'),'waiting_for_file',{uploadId:'upload-123',eligibleAt:123});store.update(first.audioFile,'transcribing');store.relocate(first.audioFile,path.join(root,'moved.wav'));
    assert.equal(store.byUpload('upload-123')?.id,first.id);assert.equal(store.byId(first.id)?.eligibleAt,undefined);assert.equal(events.length,3);
    const restarted=new ActivityStore(file);assert.equal(restarted.byId(first.id)?.stage,'interrupted');assert.equal(restarted.byId(first.id)?.resumeStage,'transcribing');assert.notEqual(restarted.epoch,store.epoch);assert.equal(restarted.snapshot().working,0);assert.equal(restarted.snapshot().failures,1);
    const merged=mergeActivity({...store.snapshot(),revision:events[1].revision},events[2]);assert.equal(merged?.revision,3);assert.equal(mergeActivity(store.snapshot(),{...events[2],revision:5}),null);assert.equal(mergeActivity(store.snapshot(),{...events[2],epoch:'restart'}),null);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('imports recognize content, never overwrite audio or sidecar, and reject empty, oversize and disguised text',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-upload-test-'));try{
    const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);
    const one=saveUploadedAudio(wav,'meeting.webm',undefined,root);assert.equal(path.extname(one),'.wav');
    const two=saveUploadedAudio(wav,'meeting.webm',undefined,root);assert.notEqual(one,two);assert.deepEqual(fs.readFileSync(one),wav);
    fs.writeFileSync(path.join(root,'sidecar.json'),'preserve');assert.notEqual(saveUploadedAudio(wav,'sidecar.wav',undefined,root),path.join(root,'sidecar.wav'));
    assert.throws(()=>saveUploadedAudio(Buffer.from('plain text'),'fake.wav',undefined,root),/Unsupported/);assert.throws(()=>saveUploadedAudio(Buffer.alloc(0),'empty.wav',undefined,root),/nonempty/);assert.throws(()=>saveUploadedAudio(Buffer.alloc(MAX_UPLOAD_BYTES+1),'huge.wav',undefined,root),/80 MiB/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Force retains a quiet-write guard, exposes deadline, and clears waiting when stable',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-settle-test-'));try{
    const file=path.join(root,'one.wav');fs.writeFileSync(file,'bytes');assert.equal(inspectFileReadiness(file,2000).ready,false);let ran=0,deadline=0;
    requestWhenSettled(file,()=>{ran++;},{force:true,label:'capture-test',onWaiting:(_status,at)=>deadline=at});assert.equal(ran,0);assert.ok(deadline>Date.now());
    const past=new Date(Date.now()-5000);fs.utimesSync(file,past,past);requestWhenSettled(file,()=>{ran++;},{force:true,label:'capture-test'});assert.equal(ran,1);
    assert.equal(isSkippedWatchPath(file+'.replacement.json'),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
