import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {config,loadConfig} from '../src/config.ts';
import {saveTranscriptionModel} from '../src/lib/settingsLib.ts';
import {createTranscriptionSettingsRoutes} from '../src/settingsRoutes.ts';

test('default model persists across reload, preserves other config, and leaves runtime unchanged after rejected saves', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-model-settings-'));
  const file=path.join(root,'config.json'), runtime=structuredClone(config), override=process.env.DICTA_TRANSCRIPTION_MODEL;
  delete process.env.DICTA_TRANSCRIPTION_MODEL;
  try {
    fs.writeFileSync(file,JSON.stringify({watch:{roots:['keep']},custom:{preserve:true},transcription:{futureOption:'keep'},whisper:{model:'large-v3'}}));
    for (const model of ['bark-pro','large-v3','turbo'] as const) {
      const result=saveTranscriptionModel(model,runtime,file);
      assert.equal(result.transcription.model,model); assert.equal(runtime.transcription.model,model);
      assert.equal(loadConfig(file).transcription.model,model);
      const disk=JSON.parse(fs.readFileSync(file,'utf8'));
      assert.deepEqual(disk.watch,{roots:['keep']});assert.deepEqual(disk.custom,{preserve:true});assert.equal(disk.transcription.futureOption,'keep');
    }
    const before=fs.readFileSync(file,'utf8');
    assert.throws(()=>saveTranscriptionModel('arbitrary-command',runtime,file),/Choose/);
    assert.equal(fs.readFileSync(file,'utf8'),before);
    process.env.DICTA_TRANSCRIPTION_MODEL='large-v3';
    assert.equal(loadConfig(file).transcription.model,'large-v3');
    assert.throws(()=>saveTranscriptionModel('bark-pro',runtime,file),/override/);
    delete process.env.DICTA_TRANSCRIPTION_MODEL;
    fs.writeFileSync(file,'broken JSON');assert.throws(()=>saveTranscriptionModel('bark-pro',runtime,file));assert.equal(runtime.transcription.model,'turbo');
    // Parent is a file: persistence failure must not pretend the running default changed.
    assert.throws(()=>saveTranscriptionModel('bark-pro',runtime,path.join(file,'config.json')));assert.equal(runtime.transcription.model,'turbo');
    assert.equal(fs.readFileSync(file,'utf8'),'broken JSON');
  } finally { if(override===undefined)delete process.env.DICTA_TRANSCRIPTION_MODEL;else process.env.DICTA_TRANSCRIPTION_MODEL=override;fs.rmSync(root,{recursive:true,force:true}); }
});

test('Settings POST accepts only the model and cannot redirect the config target', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-settings-http-')), file=path.join(root,'config.json');
  const runtime=structuredClone(config), app=express();app.use(express.json());
  for(const route of createTranscriptionSettingsRoutes(runtime,file))app.post(route.path,route.handler);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/settings/transcription`;
  const post=(body:unknown)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    assert.equal((await post({model:'turbo',file:'elsewhere'})).status,400);assert.equal(fs.existsSync(file),false);
    assert.equal((await post({model:'bogus'})).status,409);assert.equal(fs.existsSync(file),false);
    const response=await post({model:'bark-pro'});assert.equal(response.status,200);assert.equal((await response.json()).transcription.model,'bark-pro');
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).transcription.model,'bark-pro');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});}
});
