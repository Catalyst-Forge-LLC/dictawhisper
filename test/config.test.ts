import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dictaConfigFileSchema, resolveApiListenPort } from '../src/config.ts';

test('empty config file gets defaults', () => {
  const parsed = dictaConfigFileSchema.parse({});
  assert.equal(parsed.http.port, 8008);
  assert.equal(parsed.http.host, '127.0.0.1');
  assert.equal(parsed.watch.settleMinutes, 30);
  assert.equal(parsed.watch.browserSettleMs, 0);
  assert.equal(parsed.ollanet.required, false);
  assert.equal(parsed.audio.preprocess, true);
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
