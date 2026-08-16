import fs from 'fs';
import { spawnSync } from 'child_process';
import { config, configPath } from './config.ts';

function log(ok: boolean, message: string) {
  console.log(`[doctor] ${ok ? 'ok' : 'MISSING'}  ${message}`);
}

if (!fs.existsSync(configPath)) {
  console.error(`[doctor] config.json missing — copy config.example.json to ${configPath}`);
  process.exit(1);
}

console.log(`[doctor] config ${configPath}`);
console.log(`[doctor] http ${config.http.host}:${config.http.port}`);
console.log(`[doctor] ui cors ${config.http.corsOrigins.join(', ')}`);
console.log(
  `[doctor] settle phone ${config.watch.settleMinutes}m; browser ${config.watch.browserSettleMs}ms`
);

let failed = false;
for (const root of config.watch.roots) {
  const exists = fs.existsSync(root);
  log(exists, `watch root ${root}`);
  if (!exists) failed = true;
}

const drop = config.watch.browserDropFolder;
if (!fs.existsSync(drop)) {
  fs.mkdirSync(drop, { recursive: true });
}
log(true, `browser drop ${drop}`);

const python = config.whisper.python;
const pythonOk = python === 'python' || python === 'python3' || fs.existsSync(python);
log(pythonOk, `python ${python}`);
if (!pythonOk) failed = true;

const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
const ffmpegOk = ffmpeg.status === 0;
log(ffmpegOk, ffmpegOk ? 'ffmpeg on PATH' : 'ffmpeg not on PATH (denoise will fail)');
if (!ffmpegOk && config.audio.preprocess) failed = true;

const machine = config.ollanet.machine.trim();
const model = config.ollanet.cleanModel.trim();
const ollanetConfigured = machine.length > 0 && !machine.startsWith('YOUR-') && model.length > 0 && !model.startsWith('YOUR-');
log(ollanetConfigured, ollanetConfigured ? `ollanet ${machine} / ${model}` : 'ollanet machine/model not configured');

if (failed) {
  console.error('[doctor] fix the missing items above, then retry');
  process.exit(1);
}

console.log('[doctor] ready');
