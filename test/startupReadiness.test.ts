import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';

test('checkout and compiled startup report exact config/endpoints and keep the inbox readable with blocked transcription',{timeout:90000},async()=>{
 const runtimeBuild=spawnSync(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(runtimeBuild.status,0,runtimeBuild.stdout+runtimeBuild.stderr);
 if(!fs.existsSync('dist/ui/index.html')) {
  const uiBuild=spawnSync(process.execPath,[path.resolve('client/node_modules/vite/bin/vite.js'),'build'],{cwd:path.resolve('client'),encoding:'utf8',windowsHide:true,timeout:45000});
  assert.equal(uiBuild.status,0,uiBuild.stdout+uiBuild.stderr);
 }
 for(const compiled of [false,true]) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dicta-startup-readiness-'));
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await new Promise<void>(resolve=>reservation.once('listening',resolve));const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const configPath=path.join(root,'config.json');fs.writeFileSync(configPath,JSON.stringify({http:{host:'127.0.0.1',port,tailscale:false},watch:{roots:[],browserDropFolder:path.join(root,'captures')},whisper:{python:path.join(root,'missing-python.exe'),model:'fixture'},queues:{transcription:{active:false},processing:{active:false}},ollanet:{machine:'',cleanModel:'',required:false},journal:{index:path.join(root,'index.sqlite'),search:'lex'}}));
  const file=path.resolve(compiled?'dist/server.js':'src/server.ts');assert.ok(fs.existsSync(file),'Build the runtime before running packaged startup verification.');
  // Keep the loopback fixture independent of a parent dashboard's listen host.
  const child=spawn(process.execPath,[...(compiled?[]:['--experimental-strip-types']),file],{cwd:path.resolve('.'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DICTA_API_PORT:String(port),DICTA_UI_PORT:String(port),DICTA_CONFIG:configPath,DICTA_SERVE_UI:'1',DICTA_TAILSCALE:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>output+=part);
  try {
   const deadline=Date.now()+12000;while(!output.includes('[health] Search readiness') && child.exitCode===null && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));
   assert.match(output,new RegExp(`API http://127\\.0\\.0\\.1:${port}`));assert.ok(output.includes(configPath));assert.match(output,/Required for transcription/);assert.match(output,/Cleanup \(optional unless ollanet.required\)/);assert.match(output,/Search readiness/);assert.match(output,/python not found/);assert.match(output,/inbox will still serve notes already on disk/);
   const response=await fetch(`http://127.0.0.1:${port}/`);assert.equal(response.status,200);assert.match(await response.text(),/sveltekit|_app/);
   const settings=await(await fetch(`http://127.0.0.1:${port}/settings`)).json();assert.equal(settings.configPath,configPath);assert.equal(settings.network.apiUrl,`http://127.0.0.1:${port}`);assert.equal(settings.network.servesInbox,true);assert.equal(settings.cleanup.available,false);assert.ok(fs.existsSync(settings.integrations.mcp.args.at(-1)));
  } finally {
   if(child.exitCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await exited;}
   const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('dicta-startup-readiness-'));fs.rmSync(resolved,{recursive:true,force:true});
  }
 }
});
