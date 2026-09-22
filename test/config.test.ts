import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  dictaConfigFileSchema,
  resolveApiListenPort,
  resolveConfigPath,
  resolveListenPort,
} from '../src/config.ts';

test('empty config file gets defaults', () => {
  const parsed = dictaConfigFileSchema.parse({});
  assert.equal(parsed.http.port, 8008);
  assert.equal(parsed.http.host, '127.0.0.1');
  assert.equal(parsed.watch.settleMinutes, 30);
  assert.equal(parsed.watch.browserSettleMs, 0);
  assert.equal(parsed.ollanet.required, false);
  assert.equal(parsed.audio.preprocess, true);
  assert.equal(parsed.journal.embedHost, 'local');
});

test('unknown keys are stripped', () => {
  const parsed = dictaConfigFileSchema.parse({ mystery: true, whisper: { model: 'turbo' } });
  assert.equal('mystery' in parsed, false);
  assert.equal(parsed.whisper.model, 'turbo');
});

test('invalid port is rejected', () => {
  assert.throws(() => dictaConfigFileSchema.parse({ http: { port: -1 } }));
});

test('UI lease PORT does not become the API port', () => {
  assert.equal(resolveApiListenPort('7777', 7777, 8008, 8008), 8008);
  assert.equal(resolveApiListenPort('8008', 7777, 8008, 8008), 8008);
  assert.equal(resolveApiListenPort(undefined, 7777, 8008, 8008), 8008);
});

test('packaged inbox binds the UI port', () => {
  assert.equal(resolveListenPort('8008', 7777, 8008, 8008, true), 7777);
  assert.equal(resolveListenPort(undefined, undefined, 8008, 8008, true), 7777);
  assert.equal(resolveListenPort('8008', 7777, 8008, 8008, false), 8008);
});

test('config path prefers env, then cwd, then home', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'dicta-cfg-'));
  const cwd = path.join(tmp, 'cwd');
  const home = path.join(tmp, 'home');
  mkdirSync(cwd);
  mkdirSync(path.join(home, '.dictawhisper'), { recursive: true });
  writeFileSync(path.join(home, '.dictawhisper', 'config.json'), '{}');
  assert.equal(
    resolveConfigPath({}, cwd, home),
    path.join(home, '.dictawhisper', 'config.json'),
  );
  writeFileSync(path.join(cwd, 'config.json'), '{}');
  assert.equal(resolveConfigPath({}, cwd, home), path.join(cwd, 'config.json'));
  assert.equal(
    resolveConfigPath({ DICTA_CONFIG: path.join(tmp, 'explicit.json') }, cwd, home),
    path.join(tmp, 'explicit.json'),
  );
});
