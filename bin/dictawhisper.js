#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src', 'cli.ts');
const child = spawn(process.execPath, ['--experimental-strip-types', cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
});
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
