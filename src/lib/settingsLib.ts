import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {config,configPath} from '../config.ts';
import {dictawhisperVersion} from './cleanupProvenanceLib.ts';
import {apiListenHost} from './tailscaleLib.ts';
import {resolveWhisperModel,getWhisperWorkerStatus} from './whisperLib.ts';
import {mayDoCapabilities} from './mayDoService.ts';
export function effectiveSettings() {
 const runtime=path.dirname(fileURLToPath(import.meta.url));
 const mcp=path.resolve(runtime,'..',runtime.endsWith('lib') && runtime.includes(`${path.sep}dist${path.sep}`)?'mcp.js':'mcp.ts');
 const compiled=mcp.endsWith('.js');
 return {
   version:dictawhisperVersion(), configPath, readOnly:true,
   folders:{...config.watch,roots:config.watch.roots.map(file=>({file,exists:fs.existsSync(file)}))},
   transcription:{...config.whisper,model:resolveWhisperModel(),worker:getWhisperWorkerStatus(),...config.audio,queue:config.queues.transcription},
   cleanup:{...config.ollanet,queue:config.queues.processing,...mayDoCapabilities()},
   search:{...config.journal},
   network:{...config.http,listenHost:apiListenHost(config),apiUrl:`http://${apiListenHost(config)==='0.0.0.0'||apiListenHost(config)==='::'?'127.0.0.1':apiListenHost(config)}:${config.http.port}`,servesInbox:process.env.DICTA_SERVE_UI==='1'||process.env.DICTA_SERVE_UI==='true'},
   integrations:{mcp:{command:process.execPath,args:compiled?[mcp]:['--experimental-strip-types',mcp],env:{DICTA_CONFIG:configPath}},exoMetaCortex:'Not connected; integration is planned.'},
 };
}
