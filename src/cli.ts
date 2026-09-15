#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleConfig = path.join(packageRoot, 'config.example.json');
const serverPath = path.join(packageRoot, 'src', 'server.ts');
const doctorPath = path.join(packageRoot, 'src', 'doctor.ts');
const uiDir = path.join(packageRoot, 'dist', 'ui');

function usage(): string {
  return `dictawhisper — local voice journal

Usage:
  dictawhisper init [--home]     write config.example.json
  dictawhisper doctor            check python / CUDA / ffmpeg / ollanet
  dictawhisper start             API + inbox (default)
  dictawhisper serve             same as start

A global install serves the packaged inbox. Checkout still uses pnpm dev.

Config (first hit wins):
  $DICTA_CONFIG
  ./config.json
  ~/.dictawhisper/config.json

Requires Node 20+ and a Python with faster-whisper. See dictawhisper.com
`;
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function resolveExistingConfig(): string | null {
  const fromEnv = process.env.DICTA_CONFIG?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const inCwd = path.resolve(process.cwd(), 'config.json');
  if (existsSync(inCwd)) return inCwd;
  const inHome = path.join(os.homedir(), '.dictawhisper', 'config.json');
  if (existsSync(inHome)) return inHome;
  return null;
}

function init(home: boolean): void {
  const dest = home
    ? path.join(os.homedir(), '.dictawhisper', 'config.json')
    : path.resolve(process.cwd(), 'config.json');
  if (existsSync(dest)) {
    fail(`Already exists: ${dest}`);
  }
  if (!existsSync(exampleConfig)) {
    fail(`Missing ${exampleConfig}`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(exampleConfig, dest);
  console.log(`Wrote ${dest}`);
  console.log('Edit whisper.python, then: dictawhisper doctor');
}

function runNode(script: string, extraEnv: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ['--experimental-strip-types', script], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    windowsHide: false,
  });
}

function start(): void {
  const configFile = resolveExistingConfig();
  if (!configFile) {
    fail('No config.json. Run: dictawhisper init\nThen edit whisper.python and run: dictawhisper doctor');
  }
  if (!existsSync(uiDir)) {
    console.warn(`[ui] no packaged inbox at ${uiDir} — API only. In a checkout: pnpm --dir client build`);
  }
  const child = runNode(serverPath, {
    DICTA_CONFIG: configFile,
    DICTA_SERVE_UI: existsSync(uiDir) ? '1' : '',
    DICTA_UI_DIR: uiDir,
  });
  const shutdown = () => {
    if (child.pid) child.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code) => process.exit(code ?? 1));
}

function doctor(): void {
  const configFile = resolveExistingConfig();
  if (!configFile) {
    fail('No config.json. Run: dictawhisper init');
  }
  const child = runNode(doctorPath, { DICTA_CONFIG: configFile });
  child.on('exit', (code) => process.exit(code ?? 1));
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help') || args[0] === 'help') {
    console.log(usage());
    return 0;
  }
  const command = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
  if (command === 'init') {
    init(args.includes('--home'));
    return 0;
  }
  if (command === 'doctor') {
    doctor();
    return 0;
  }
  if (command === 'start' || command === 'serve') {
    start();
    return 0;
  }
  console.error(`Unknown command: ${command}\n`);
  console.log(usage());
  return 1;
}

const entry = process.argv[1]?.replaceAll('\\', '/');
if (entry && (entry.endsWith('/cli.ts') || entry.endsWith('/cli.js'))) {
  process.exitCode = main(process.argv);
}

export { main, resolveExistingConfig };
