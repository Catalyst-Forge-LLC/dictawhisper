import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkoutDevEnv, resolveApiListenPort } from '../src/lib/devPorts.ts';

const cfg = { port: 8008, host: '127.0.0.1', path: '/fixture/config.json' };

test('standalone checkout endpoints need no LocalSlip and share one API port', () => {
  const env = checkoutDevEnv({}, cfg);
  assert.equal(env.DICTA_UI_PORT, '7777');
  assert.equal(env.PORT, '8008');
  assert.equal(env.DICTA_API_PORT, env.PORT);
  assert.equal(env.DICTA_CONFIG, cfg.path);
});

test('named UI/API claims and custom config stay consistent', () => {
  const env = checkoutDevEnv({}, { ...cfg, port: 9000 }, 17777, 18008);
  assert.equal(env.DICTA_UI_PORT, '17777');
  assert.equal(env.PORT, '18008');
  assert.equal(env.DICTA_API_PORT, '18008');
  assert.equal(checkoutDevEnv({}, { ...cfg, port: 9000 }).PORT, '9000');
});

test('a UI recipe port cannot redirect the API, with or without a claim', () => {
  assert.equal(checkoutDevEnv({ PORT: '7777' }, cfg).PORT, '8008');
  assert.equal(checkoutDevEnv({ PORT: '17777' }, cfg, 17777, 18008).PORT, '18008');
  assert.equal(checkoutDevEnv({ PORT: '19000' }, cfg, 17777, 18008).PORT, '19000');
  assert.equal(resolveApiListenPort('99999', 7777, undefined, 8008), 8008);
});
