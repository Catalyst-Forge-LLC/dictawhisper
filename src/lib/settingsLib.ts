import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {config as activeConfig,configPath as activeConfigPath,type DictaConfig} from '../config.ts';
import {dictawhisperVersion} from './cleanupProvenanceLib.ts';
import {apiListenHost} from './tailscaleLib.ts';
import {resolveWhisperModel,getWhisperWorkerStatus} from './whisperLib.ts';
import {mayDoCapabilities} from './mayDoService.ts';
import {barkAvailability,barkPaths} from './barkLib.ts';
import {isTranscriptionModel} from './asrModels.ts';

/** Save just the editable field, preserving all other settings, then update the next-job default. */
export function saveTranscriptionModel(model: unknown, config = activeConfig, configPath = activeConfigPath) {
 if (!isTranscriptionModel(model)) throw new Error('Choose Bark Pro, Whisper large-v3 or Whisper turbo.');
 if (process.env.DICTA_TRANSCRIPTION_MODEL?.trim()) throw new Error('The default model is controlled by DICTA_TRANSCRIPTION_MODEL. Remove that override to save a choice here.');
 const saved = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
 if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Configuration must be a JSON object. Repair it before saving.');
 const next = {...saved, transcription: {...saved.transcription, model}};
 const temp = configPath + '.' + randomUUID() + '.tmp';
 try {
   fs.mkdirSync(path.dirname(configPath), {recursive:true});
   fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', {flag:'wx'});
   fs.renameSync(temp, configPath);
 } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
 config.transcription.model = model;
 return effectiveSettings(config, configPath);
}

export function effectiveSettings(config: DictaConfig = activeConfig, configPath = activeConfigPath) {
 const runtime=path.dirname(fileURLToPath(import.meta.url));
 const mcp=path.resolve(runtime,'..',runtime.endsWith('lib') && runtime.includes(`${path.sep}dist${path.sep}`)?'mcp.js':'mcp.ts');
 const compiled=mcp.endsWith('.js');
 return {
   version:dictawhisperVersion(), configPath, readOnly:false, editable:['transcription.model'],
   folders:{...config.watch,roots:config.watch.roots.map(file=>({file,exists:fs.existsSync(file)}))},
   transcription:{...config.whisper,model:config.transcription.model,modelLocked:Boolean(process.env.DICTA_TRANSCRIPTION_MODEL?.trim()),whisper:{...config.whisper,model:resolveWhisperModel()},bark:{...barkAvailability(),...barkPaths(),device:process.env.DICTA_BARK_DEVICE || 'cuda'},worker:getWhisperWorkerStatus(),...config.audio,queue:config.queues.transcription},
   cleanup:{...config.ollanet,queue:config.queues.processing,...mayDoCapabilities()},
   search:{...config.journal},
   network:{...config.http,listenHost:apiListenHost(config),apiUrl:`http://${apiListenHost(config)==='0.0.0.0'||apiListenHost(config)==='::'?'127.0.0.1':apiListenHost(config)}:${config.http.port}`,servesInbox:process.env.DICTA_SERVE_UI==='1'||process.env.DICTA_SERVE_UI==='true'},
   integrations:{mcp:{command:process.execPath,args:compiled?[mcp]:['--experimental-strip-types',mcp],env:{DICTA_CONFIG:configPath}},exoMetaCortex:'Not connected; integration is planned.'},
 };
}
