import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'compare_asr.py');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const result = spawnSync(config.whisper.python, [script, ...args], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(result.status ?? 1);
