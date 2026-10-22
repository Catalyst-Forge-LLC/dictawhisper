// Isolated browser acceptance app. No real config, journal, workers, or model calls.
// Build first: pnpm --dir client build
// Run: node --experimental-strip-types scripts/ux01-fixture.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { ActivityStore, setActivityStore } from '../src/lib/activityLib.ts';
import { config } from '../src/config.ts';
import { apiRoutes } from '../src/apiRoutes.ts';
import { createAudioRescueRoutes } from '../src/audioRescueRoutes.ts';
import { AudioRescueService } from '../src/lib/audioRescueService.ts';
import { TranscriptionBatchService } from '../src/lib/transcriptionBatchLib.ts';
import { createTranscriptionBatchRoutes } from '../src/transcriptionBatchRoutes.ts';
import { findAudioForSidecar } from '../src/lib/audioLib.ts';
import { setTranscriptionIo, transcriptions, readTranscription, emitTranscription } from '../src/lib/transcriptionLib.ts';
import { JournalIndex, EntryCursorError, setJournalIndex } from '../src/lib/journalIndexLib.ts';
import { MayDoJobStore } from '../src/lib/mayDoJobLib.ts';
import { extractMayDos } from '../src/lib/mayDoService.ts';
import { mayDoSourceHash, mayDoExtractionState } from '../src/lib/mayDoLib.ts';
import { parseMayDoFilter, parseMayDoStatusSet } from '../src/lib/mayDoLib.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dictawhisper-ux01-'));
config.watch.roots=[root]; config.watch.browserDropFolder=path.join(root,'captures');
config.journal.search='lex';config.journal.index=path.join(root,'journal.sqlite');config.http.tailscale=false;config.http.port=17778;
config.queues.transcription.active=false; config.queues.processing.active=false;
config.whisper.promptTerms=[]; config.whisper.python='python'; config.ollanet.machine=''; config.ollanet.cleanModel='';
const activity = new ActivityStore(path.join(root,'.dictawhisper','activity.json')); setActivityStore(activity);
const notes = new Map();
const requests = [];
const statuses = ['suggested', 'selected', 'done', 'dismissed'];
const text = Array.from({ length: 100 }, (_, i) => `Passage ${i + 1}. Kitchen repair planning and a shared fixture journal. This is sample speech for testing reader position and navigation.`).join('\n\n');
for (let i = 0; i < 200; i++) {
  const year = ['2010', '2025', '2026'][Math.floor(i / 67)];
  const day = `${year}-09-${String(i % 28 + 1).padStart(2, '0')}`;
  const file = path.join(root, year, '09', `${day}_Fixture ${String(i).padStart(3, '0')}${i === 199 ? ' A very long entry title about kitchen renovation and shared planning with enough detail to wrap across multiple lines on every reading pane' : ''}.json`);
  const json = { text, elapsed: '73.645s', cleanedTranscription: text, starred: i % 10 === 0,
    tags: i === 199 ? Array.from({ length: 22 }, (_, n) => `fixture-tag-${n + 1}`) : [i % 2 === 0 ? 'home' : 'work', i % 3 === 0 ? 'budget' : 'ideas'],
    playbackCues: text.split('\n\n').map((text, cue) => ({ text, start: cue * 0.8, end: (cue + 1) * 0.8 })),
    mayDos: [{ id: `action-${i}`, title: 'Consider repairing the kitchen', sourceQuote: 'Kitchen repair planning', status: statuses[i % 4] }],
    ...(i === 22 ? { cleanupError: 'Fixture cleanup host unavailable' } : {}),
  };
  if (i === 196) {
    json.mayDos = statuses.map((status,n) => ({id:`review-${status}`,title:['Plan kitchen repair','Call the contractor','Finish the budget','Replace the curtains'][n],sourceQuote:'Kitchen repair planning',status,start:n===3?null:0,end:n===3?null:0.8}));
    json.mayDoExtraction={version:1,sourceHash:mayDoSourceHash(text),createdAt:'2020-01-01T00:00:00.000Z'};
  }
  if (i === 195) json.mayDoExtraction={version:0,sourceHash:'stale',createdAt:'2020-01-01T00:00:00.000Z'};
  if (i === 197) {
    json.segments = ['First original passage.', 'Second original passage, with <literal> text.\nA line within the passage.', 'Final original passage.'].map((text, n) => ({text,start:n*5,end:n*5+5}));
    json.text = json.segments.map(segment => segment.text.replace(/\s+/g, ' ')).join(' ');
    json.cleanedTranscription = 'First readable paragraph.\n\nSecond readable paragraph.\nA line within the paragraph.';
    json.playbackCues = json.cleanedTranscription.split('\n\n').map((text,n) => ({text,start:n*5,end:n*5+5}));
  }
  if (i === 198) { delete json.cleanedTranscription; delete json.playbackCues; json.text = 'Original-only fixture text. Copying and reading work without cleanup.'; }
  if (i === 193 && process.env.DICTA_FIXTURE_PARAGRAPHS === '1') {
    const sentences = Array.from({length:26}, (_,n) => `Planning step ${n+1} is to review the kitchen measurements before ordering materials.`);
    json.text = json.cleanedTranscription = sentences.join(' ');
    const words = json.text.split(' ').map((word,n) => ({word,start:n*.2,end:(n+1)*.2}));
    json.segments = [{text:json.text,start:0,end:words.at(-1).end,words}];
    json.playbackCues = [{text:json.text,start:0,end:words.at(-1).end}]; json.playbackCuesSource = 'words';
  }
  if (i === 192 && process.env.DICTA_FIXTURE_SIGNALS === '1') {
    json.segments = Array.from({length:48}, (_,n) => ({start:n*1.8,end:n*1.8+1.2,text:`Planning detail ${n+1}: check the kitchen measurements before ordering materials.`}));
    json.text = json.segments.map(row=>row.text).join(' ');
    json.cleanedTranscription = json.segments.map(row=>row.text).join('\n\n');
    json.playbackCues = json.segments;
    json.transcriptionQuality = {version:1,model:'large-v3',createdAt:'2026-10-21T00:00:00Z',preparation:{selectedPreset:'uneven',durationSec:90,assessment:{reasons:['Audible levels vary across the recording.']}},issues:[
      ...json.segments.map((row,n)=>({kind:n%2?'uncovered_audio':'uncertain',start:row.start,end:row.end,message:n%2?'Audio was detected without matching transcript text. It may be speech, music or noise.':'Whisper reported uncertain speech here.',...(n===0?{alternative:'Check the kitchen measurements before we order materials.'}:n===1?{alternative:''}:n===2?{retryError:'Fixture alternate pass unavailable.'}:n===3?{alternative:'Long alternate text for overflow testing. '.repeat(130)}:{})})),
      {kind:'audio',message:'The available recording has varying volume.'},
      {kind:'timing',message:'A segment had invalid timing.'},{kind:'timing',message:'A segment had invalid timing.'},
    ]};
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json));
  notes.set(file, { jsonFile: file, day, transcriptionJson: json });
}
for (const folder of ['_holding', '_unfiled']) {
  const file = path.join(root, folder, `${folder}.json`);
  const json = { text: 'Unorganized shared fixture entry', tags: ['home'] };
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json));
  notes.set(file, { jsonFile: file, transcriptionJson: json });
}
for(const relative of ['_holding/2026-10-01_Conflict.json','2026/10/2026-10-01_Conflict.json']) {
  const file=path.join(root,relative),incoming=relative.startsWith('_holding');
  const json={text:incoming?'Incoming fixture speech.':'Existing fixture speech to preserve.',displayTitle:incoming?'Incoming conflict entry':'Existing conflict entry',tags:['fixture','home']};
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(json));notes.set(file,{jsonFile:file,transcriptionJson:json});
  for(const suffix of ['.wav','_original.mp3','_clean.ogg'])fs.writeFileSync(file.slice(0,-5)+suffix,'Fixture audio '+relative+suffix);
}
// Dense processing states for whole-app UX verification, never real workers.
if (process.env.DICTA_FIXTURE_UX_PASS === '1') {
  [...notes.keys()].slice(0, 36).forEach((file, n) => {
    const stage = n < 18 ? 'failed_maydos' : n < 24 ? 'queued_transcription' : 'ready';
    activity.update(file.slice(0,-5)+'.wav', stage, {jsonFile:file,originalName:`Review recording ${n+1}`,hasTranscript:true,...(n<18?{error:'Fixture model unavailable. The transcript is still readable.'}:{})});
  });
}
let fixtureTime = Date.now();
const index = new JournalIndex(path.join(root, 'journal.sqlite'), { now: () => fixtureTime });
setJournalIndex(index);index.rebuildFromRoots([root]);
for(const [file,note] of notes)transcriptions[file]=note.transcriptionJson;
index.ensureVec(2, 'fixture'); for (const row of index.rowsNeedingEmbed()) index.putEmbedding(row.rowid, [1, 0]);
const app = express();
app.use(express.json());
// Response policy can exercise clipboard rejection in browsers enforcing clipboard-write.
// Some automated browser clipboard bridges do not enforce this policy.
app.use((req, res, next) => { if (req.query.clipboardDenied === '1') res.setHeader('Permissions-Policy', 'clipboard-write=()'); next(); });
app.use((req, _res, next) => { if (!req.path.startsWith('/_app')) requests.push({ method: req.method, path: req.path, query: req.query }); next(); });
let uploadMode='normal';
let batchFixture;
// Opt-in readable journey: deterministic UI states, never invokes a model.
if (process.env.DICTA_FIXTURE_CLEANUP === '1') {
  app.post('/process/force', (req, res) => {
    const file = String(req.body.file || '');
    if (!notes.has(file)) return res.status(404).json({error:'Fixture entry not found.'});
    if (['queued_cleanup','cleaning'].includes(activity.find(file)?.stage)) return res.status(202).json({ok:true});
    activity.update(file, 'queued_cleanup', {hasTranscript:true});
    res.status(202).json({ok:true});
    setTimeout(() => activity.update(file, 'cleaning', {hasTranscript:true}), 600);
    setTimeout(() => {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      json.cleanedTranscription = 'The printer stopped again. I checked the cable; it was plugged in. Why does it keep doing that?\n\nI like the new desk. It looks like oak. I was about to…';
      delete json.cleanupSkipped; delete json.cleanupError; delete json.playbackCues;
      fs.writeFileSync(file, JSON.stringify(json)); index.upsertSidecar(file);
      activity.update(file, 'ready', {hasTranscript:true}); emitTranscription(null, file);
    }, 3500);
  });
}
app.post('/__fixture/upload-mode',(req,res)=>{uploadMode=req.body.mode;res.json({ok:true});});
app.post('/audio',(req,res,next)=>{
  const mode=uploadMode;uploadMode='normal';
  if(mode==='fail')return res.status(503).json({error:'Fixture upload unavailable; retry keeps your audio.'});
  if(mode==='unknown'){res.json=()=>{res.status(200).type('json').end('{');return res;};}
  next();
});
app.get('/notes/activity',(_req,res)=>res.json({...activity.snapshot(),mayDoBackfill:{...jobs.snapshot(),...capabilities},transcriptionBatch:batchFixture?.summary()}));
app.post('/notes/activity/retry',async(req,res,next)=>{const item=activity.byId(req.body.id);if(item?.stage==='failed_maydos'||item?.stage==='interrupted'&&item.resumeStage==='extracting_maydos'){try{await fixtureExtract(item.jsonFile);res.status(202).json({ok:true,item:activity.byId(item.id)});}catch(error){res.status(409).json({error:error.message});}}else next();});
for(const route of apiRoutes.filter(route=>['/audio/capabilities','/audio/upload','/notes/activity/retry','/notes/activity/process-now'].includes(route.path) || route.path==='/audio'&&route.method==='POST'))app[route.method.toLowerCase()](route.path,route.handler);
app.post('/notes/trash/remove',(req,res,next)=>{if(trashMode==='fail'){trashMode='normal';return res.status(503).json({error:'Fixture removal unavailable. Entry retained; try again.'});}next();});
for(const route of apiRoutes.filter(route=>route.path.startsWith('/notes/trash')||route.path.startsWith('/notes/organization')||['/settings','/tools/entries/identity','/tools/index/rebuild','/tags/consolidate/preview','/tags/consolidate/apply'].includes(route.path)))app[route.method.toLowerCase()](route.path,route.handler);
let trashMode='normal';app.post('/__fixture/trash-mode',(req,res)=>{trashMode=req.body.mode;res.json({ok:true});});
let extractionMode='normal', extractionCalls=0;
app.post('/__fixture/maydo-mode',(req,res)=>{extractionMode=req.body.mode;res.json({ok:true});});
const fixtureRunner=async()=>{
  extractionCalls++; await new Promise(resolve=>setTimeout(resolve,450));
  if(extractionMode==='fail')throw new Error('Fixture model unavailable. Try again.');
  return {mayDos:[{title:'Plan kitchen repair',verb:'plan',sourceQuote:'Kitchen repair planning'}],model:'Fixture model'};
};
async function fixtureExtract(file){const data=await extractMayDos(file,fixtureRunner);const old=notes.get(file);notes.set(file,{...old,...data});index.upsertSidecar(file);return data;}
const jobFile=path.join(root,'.dictawhisper','maydo-job.json');
const capabilities={available:true,model:'Fixture model',disabledReason:''};
function makeJobs(){return new MayDoJobStore({file:jobFile,read:file=>JSON.parse(fs.readFileSync(file,'utf8')),extract:fixtureExtract,emit:()=>io.emit('maydo-job-change',{...jobs.snapshot(),...capabilities})});}
let jobs=makeJobs();
app.get('/notes/may-dos/capabilities',(_req,res)=>res.json(capabilities));
app.get('/tools/may-dos/backfill',(_req,res)=>res.json({...jobs.snapshot(),...capabilities}));
app.post('/tools/may-dos/backfill',(req,res)=>{try{
  if(req.body.action==='stop')jobs.stop(req.body.id);
  else if(req.body.action==='resume'||req.body.action==='retry_failed')jobs.resume(req.body.id,req.body.action==='retry_failed');
  else {const files=index.list({all:true,folder:'active'}).filter(row=>!req.body.year||row.day.startsWith(req.body.year+'-')).map(row=>row.jsonFile);jobs.start(files,{year:req.body.year||undefined,refresh:req.body.refresh===true});}
  res.json({...jobs.snapshot(),...capabilities});
}catch(error){res.status(409).json({error:error.message});}});
app.post('/notes/may-dos/extract',async(req,res)=>{try{res.json(await fixtureExtract(req.body.file));}catch(error){res.status(500).json({error:error.message});}});
app.post('/__fixture/maydo-disabled',(req,res)=>{capabilities.available=!req.body.disabled;capabilities.disabledReason=req.body.disabled?'Configure the cleanup model to extract MayDos. Saved actions remain available.':'';res.json(capabilities);});
app.get('/__fixture/maydo-calls',(_req,res)=>res.json({calls:extractionCalls}));
app.get('/health', (_req,res)=>res.json({ok:true,degraded:true,checks:[{id:'python',group:'transcription',level:'ok',message:'Fixture transcription ready'},{id:'ollanet',group:'cleanup',level:'warn',message:'Fixture optional cleanup offline; Original remains readable'},{id:'journal-search',group:'search',level:'ok',message:'Fixture words search ready'}]}));
app.get('/status',(_req,res)=>res.json({done:200,rawOnly:1,pendingAudio:0,unreadable:0}));
app.get('/tools/probe',(_req,res)=>res.json({running:false}));
app.get('/notes/index', (req, res) => res.json({ notes: index.list({ all: req.query.all === '1', folder: req.query.folder }), paged: false }));
app.get('/notes/years', (_req, res) => res.json({ years: index.years() }));
app.get('/notes/tags', (_req, res) => res.json({ tags: index.tags({ includeSingletons: true }) }));
app.get('/notes/stats', (_req, res) => res.json(index.stats()));
app.get('/notes/search', (req, res) => {
  try {
    const paged = req.query.page === '1';
    const result = (paged ? index.searchPage.bind(index) : index.search.bind(index))({ cursor: req.query.cursor, mode: req.query.mode, queryEmbedding: req.query.mode === 'hybrid' && !req.query.cursor ? [1, 0] : null, query: req.query.q, tags: req.query.tag ? [].concat(req.query.tag) : [],
      since: req.query.since, until: req.query.until, year: req.query.year, month: req.query.month,
      sort: req.query.sort, limit: 50, folder: req.query.folder, attention: req.query.attention === '1',
      starred: req.query.starred === '1', unreadable: req.query.unreadable === '1',
      mayDos: parseMayDoStatusSet(req.query.mayDoStatus) || parseMayDoFilter(req.query.mayDos) });
    // Deliberately return one old query late to exercise stale-response rejection.
    setTimeout(() => res.json(paged ? result : { hits: result, count: result.length }), req.query.q === 'slow' ? 1400 : 40);
  } catch (error) { res.status(error instanceof EntryCursorError && error.code === 'cursor_expired' ? 409 : 400).json({ error: error.message, code: error.code }); }
});
app.get('/note', (req, res) => {
  const note = fs.existsSync(String(req.query.file)) ? (notes.get(req.query.file)||readTranscription(String(req.query.file))) : null;
  if(note) {
    note.transcriptionJson=process.env.DICTA_FIXTURE_PARAGRAPHS === '1' ? readTranscription(note.jsonFile).transcriptionJson : JSON.parse(fs.readFileSync(note.jsonFile,'utf8'));
    note.transcriptionJson.mayDoState=mayDoExtractionState(note.transcriptionJson);
  }
  setTimeout(() => note ? res.json(note) : res.status(404).json({ error: 'Fixture entry unavailable' }), String(req.query.file).includes('Fixture 003') ? 1600 : 50);
});
app.post('/note', (req, res) => {
  const note = notes.get(req.body.file);
  if (!note) return res.status(404).json({ error: 'Fixture entry unavailable' });
  if (typeof req.body.displayTitle === 'string') { if (req.body.displayTitle.trim().length > 160) return res.status(400).json({ error: 'Display title too long' }); note.transcriptionJson.displayTitle = req.body.displayTitle.trim(); }
  if (typeof req.body.starred === 'boolean') note.transcriptionJson.starred = req.body.starred;
  if (req.body.mayDo) {
    const row=note.transcriptionJson.mayDos.find(action=>action.id===req.body.mayDo.id);
    if(req.body.mayDo.expectedStatus && row.status!==req.body.mayDo.expectedStatus)return res.status(409).json({error:'This action changed elsewhere. Refresh before trying again.'});
    row.status=req.body.mayDo.status;
  }
  if (req.body.tags) note.transcriptionJson.tags = req.body.tags;
  fs.writeFileSync(note.jsonFile, JSON.stringify(note.transcriptionJson)); index.upsertSidecar(note.jsonFile);
  res.json(note);
});
const wav = Buffer.alloc(44 + 8000 * 2 * 90);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const fixtureAudio=path.join(root,'fixture-audio.wav');fs.writeFileSync(fixtureAudio,wav);
// Opt-in real FFmpeg preparation with deterministic ASR output; no GPU/model calls.
// DICTA_FIXTURE_AUDIO_RESCUE=1 node --experimental-strip-types scripts/ux01-fixture.mjs
if (process.env.DICTA_FIXTURE_AUDIO_RESCUE === '1') {
  config.queues.transcription.active = true;
  config.watch.settleMinutes = 0;
  const quiet = Buffer.from(wav.subarray(0, 44 + 16000 * 4));
  quiet.writeUInt32LE(quiet.length - 8, 4); quiet.writeUInt32LE(quiet.length - 44, 40);
  for (let i = 0; i < (quiet.length - 44) / 2; i++) quiet.writeInt16LE(Math.round(100 * Math.sin(i * 2 * Math.PI * 440 / 8000)), 44 + i * 2);
  for (const file of [...notes.keys()].filter(file => /Fixture (19[89]|20[01])/.test(file))) fs.writeFileSync(file.slice(0, -5) + '_original.wav', quiet);
  let candidateCount = 0;
  const rescue = new AudioRescueService({ transcribe: async (_audio, output, model, vad, report) => {
    await new Promise(resolve => setTimeout(resolve, 2200));
    fs.writeFileSync(output, JSON.stringify({ text: 'Recovered fixture speech. Remember to call the contractor about the kitchen repair. This is deterministic test text, not speech recognition output.', segments: [{ start: 0, end: 4, text: 'Recovered fixture speech. Remember to call the contractor about the kitchen repair.' }], whisper: { model, vad_filter: vad }, transcriptionQuality: {version:1,model,vadFilter:vad,preparation:report,issues:++candidateCount % 2 ? [] : [{kind:'uncertain',start:1,end:3,message:'Fixture review signal: listen to this passage.',alternative:'Alternative fixture speech retained for review.'}]} }));
  } });
  for (const route of createAudioRescueRoutes(rescue)) app[route.method.toLowerCase()](route.path, route.handler);
  const batches = new TranscriptionBatchService(path.join(root,'.dictawhisper','transcription-batch.json'),{rescue,list:()=>index.list({all:true,folder:'active'}),emit:()=>io.emit('transcription-batch-change')});
  batchFixture=batches;
  for (const route of createTranscriptionBatchRoutes(()=>batches)) app[route.method.toLowerCase()](route.path,route.handler);
  app.get('/audio', (req, res, next) => { const file = findAudioForSidecar(String(req.query.file || '')); if (file) res.sendFile(file); else next(); });
}
app.get('/audio', (req, res) => { if (String(req.query.file).includes('Fixture 197')) { res.status(404).json({ error: 'Missing fixture audio' }); return; } res.sendFile(fixtureAudio); });
app.post('/__fixture/expire', (_req, res) => { fixtureTime += 60_001; res.json({ ok: true }); });
app.get('/__fixture/events', (_req, res) => res.json({ root, requests }));
app.post('/__fixture/advance',(req,res)=>{
  const item=activity.snapshot().items.find(item=>item.uploadId===req.body.uploadId)||activity.snapshot().items[0];
  if(!item)return res.status(404).json({error:'No capture'});
  const json={text:'Original transcript arrived. Keep the audio position while reading.',cleanedTranscription:'Cleaned transcript arrived. Keep the audio position while reading.',tags:['fixture'],playbackCues:[{start:0,end:90,text:'Cleaned transcript arrived. Keep the audio position while reading.'}]};
  fs.writeFileSync(item.jsonFile,JSON.stringify(json));notes.set(item.jsonFile,{jsonFile:item.jsonFile,transcriptionJson:json});index.upsertSidecar(item.jsonFile);
  activity.update(item.audioFile,req.body.stage || 'ready',{hasTranscript:true,error:req.body.stage==='failed_cleanup'?'Fixture cleanup unavailable':undefined});res.json({ok:true,item:activity.find(item.audioFile)});
});
app.post('/__fixture/disconnect',(_req,res)=>{io.disconnectSockets(true);res.json({ok:true});});
app.get('/',(req,res)=>{
  let html=fs.readFileSync(path.resolve('dist/ui/index.html'),'utf8');
  if(req.query.captureCase){
    const mode=JSON.stringify(req.query.captureCase), bytes=JSON.stringify([...wav.subarray(0,44+16000)]);
    const script=`<script>const mode=${mode};let requests=0,stops=0;function report(){let out=document.querySelector('[data-fixture-media]');if(!out){out=document.createElement('output');out.dataset.fixtureMedia='true';out.style='position:fixed;bottom:0;left:0;font-size:10px;z-index:9999';document.body.append(out);}out.textContent='Fixture microphone requests '+requests+' · released '+stops;}Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{requests++;report();if(mode!=='working')throw Object.assign(new Error('Fixture microphone'),{name:mode==='denied'?'NotAllowedError':'NotFoundError'});return {getTracks:()=>[{stop:()=>{stops++;report();}}]};}}});window.MediaRecorder=class{state='inactive';mimeType='audio/wav';start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([new Uint8Array(${bytes})],{type:'audio/wav'})});this.onstop?.();});}};window.addEventListener('DOMContentLoaded',report);</script>`;
    html=html.replace('</body>',script+'</body>');
  }
  res.type('html').send(html);
});
app.use(express.static(path.resolve('dist/ui')));
app.use((_req, res) => res.sendFile(path.resolve('dist/ui/index.html')));
const server = createServer(app);
const io=new Server(server);setTranscriptionIo(io);activity.setEmitter(event=>io.emit('activity-change',event));io.on('connection',socket=>socket.emit('activity-snapshot',activity.snapshot()));
server.listen(17778, '127.0.0.1', () => console.log('UX01 fixture: http://127.0.0.1:17778/ (204 isolated entries)'));
function stop() {
  server.close(); index.close();
  const resolved = path.resolve(root);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('dictawhisper-ux01-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  process.exit();
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
