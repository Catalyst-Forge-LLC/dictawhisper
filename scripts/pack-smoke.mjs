#!/usr/bin/env node
// Exercise the actual tarball under node_modules without using the operator's notes/config.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'dictawhisper-pack-smoke-'));
let commandNumber = 0;
const env = { ...process.env, DICTA_CONFIG: path.join(work, 'config.json'), WHISPER_PYTHON: '', OLLANET_CONFIG: path.join(work, 'ollanet.json') };
writeFileSync(path.join(work, 'package.json'), '{"private":true}\n');
// Prevent loading the user's global ollanet configuration during diagnostic checks.
writeFileSync(env.OLLANET_CONFIG, '{"hosts":[],"discovery":{},"aliases":{}}\n');

function run(command, args, cwd = work, expected = 0, combine = true) {
  let executable = command;
  let commandArgs = args;
  if (process.platform === 'win32' && command === 'npm') {
    const quoted = args.map(value => {
      if (/["&|<>^%!\r\n]/.test(value)) throw new Error(`Unsupported shell character in npm argument: ${value}`);
      return `"${value}"`;
    });
    executable = 'cmd.exe';
    commandArgs = ['/d', '/s', '/c', `npm ${quoted.join(' ')}`];
  }
  const result = spawnSync(executable, commandArgs, { cwd, env, encoding: 'utf8', timeout: 180_000, windowsHide: true, windowsVerbatimArguments: executable === 'cmd.exe' });
  writeFileSync(path.join(work, `command-${commandNumber++}.log`), `${command} ${args.join(' ')}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return combine ? `${result.stdout ?? ''}${result.stderr ?? ''}` : result.stdout;
}

// pnpm build is a prerequisite; ignoring scripts here avoids publication/login hooks.
assert.ok(existsSync(path.join(root, 'dist', 'cli.js')), 'Run pnpm build first');
const packedRaw = run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], root, 0, false);
writeFileSync(path.join(work, 'pack.json'), packedRaw);
const packed = JSON.parse(packedRaw);
// npm 11 returns an array; npm 12 returns an object keyed by package name.
const records = Array.isArray(packed) ? packed : Object.values(packed);
assert.equal(records.length, 1, 'Expected one local package');
assert.equal(records[0].name, 'dictawhisper');
console.log(`pack-smoke: fixture ${work}; packed ${records[0].id}`);
const tarball = path.join(work, records[0].filename);
const members = records[0].files.map(file => file.path);
for (const member of ['bin/dictawhisper.js', 'dist/cli.js', 'dist/server.js', 'dist/doctor.js', 'dist/ui/index.html', 'scripts/transcribe_faster_whisper.py']) {
  assert.ok(members.includes(member), `Missing ${member}`);
}
assert.ok(!members.some(member => member.startsWith('src/') || member.endsWith('.ts')), 'Runtime TypeScript must not ship');
run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball]);
const bin = path.join(work, 'node_modules', 'dictawhisper', 'bin', 'dictawhisper.js');
assert.match(run(process.execPath, [bin, '--help']), /dictawhisper init/);
assert.match(run(process.execPath, [bin, 'start'], work, 1), /No config.json/);
assert.match(run(process.execPath, [bin, 'init']), /Wrote/);
const original = readFileSync(env.DICTA_CONFIG, 'utf8');
assert.match(run(process.execPath, [bin, 'init'], work, 1), /Already exists/);
assert.equal(readFileSync(env.DICTA_CONFIG, 'utf8'), original, 'Repeat init changed the config');
assert.match(run(process.execPath, [bin, 'unknown-command'], work, 1), /Unknown command/);

// Load the installed doctor and its dependency graph; intentionally unavailable Python.
const config = JSON.parse(original);
config.watch.roots = [];
config.whisper.python = path.join(work, 'missing-python');
config.whisper.device = 'cpu';
config.audio.preprocess = false;
config.ollanet.machine = '';
config.ollanet.cleanModel = '';
config.journal.search = 'lex';
writeFileSync(env.DICTA_CONFIG, JSON.stringify(config, null, 2) + '\n');
const diagnostic = run(process.execPath, [bin, 'doctor'], work, 1);
assert.match(diagnostic, /python not found/);
assert.doesNotMatch(diagnostic, /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|ERR_MODULE_NOT_FOUND|Cannot find module/);
console.log(`pack-smoke: OK; installed help/init/refusal/doctor exercised at ${work}`);
console.log('No real transcription, microphone capture, or model request was performed.');
