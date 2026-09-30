#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(`Could not start DictaWhisper: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
