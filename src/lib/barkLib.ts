import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runAlternateAsr } from './whisperLib.ts';

export const BARK_MODEL = 'bark-pro';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function barkPaths() {
  return {
    python: process.env.DICTA_BARK_PYTHON || path.join(root, '.venv-bark', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    model: process.env.DICTA_BARK_MODEL_DIR || path.join(root, 'data/models/bark-pro'),
    script: path.join(root, 'scripts/transcribe_bark.py'),
  };
}
export function barkAvailability() {
  const paths = barkPaths();
  const available = fs.existsSync(paths.python) && fs.existsSync(paths.script) && ['dictawhisper-model.json','model.safetensors','config.json','tokenizer.json'].every(file => fs.existsSync(path.join(paths.model, file)));
  return { available, reason: available ? '' : 'Install the separate Bark Pro runtime with scripts/setup-bark.ps1, then refresh status.' };
}
/** Local-only candidate; diagnostics stay bounded and no transcript is logged. */
export function runBark(audio: string, output: string): Promise<void> {
  return runAlternateAsr(() => new Promise<void>((resolve, reject) => {
    const ready = barkAvailability();
    if (!ready.available) { reject(new Error(ready.reason)); return; }
    const paths = barkPaths();
    const device = process.env.DICTA_BARK_DEVICE || 'cuda';
    const child = spawn(paths.python, ['-u', paths.script, '--audio', audio, '--output', output, '--model-dir', paths.model, '--device', device], {
      windowsHide: true, env: {...process.env, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8', HF_HUB_OFFLINE:'1', HF_HUB_DISABLE_TELEMETRY:'1'},
    });
    let tail = '', timedOut = false;
    const timer = setTimeout(() => { timedOut=true; child.kill(); }, 45*60*1000);
    child.stdout.on('data', () => {});
    child.stderr.on('data', (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-3000); });
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Bark runtime could not start: ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Bark comparison timed out after 45 minutes. Your saved transcript is unchanged.'));
      else if (code !== 0) reject(new Error(`Bark comparison failed (${code}). ${tail.trim()}`));
      else resolve();
    });
  }));
}
