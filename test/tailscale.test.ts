import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiListenHost, isUnspecifiedAddress } from '../src/lib/tailscaleLib.ts';
import type { DictaConfig } from '../src/config.ts';

function http(partial: { host?: string; tailscale?: boolean }): DictaConfig['http'] {
  return {
    host: partial.host ?? '127.0.0.1',
    port: 8008,
    corsOrigins: [],
    tailscale: partial.tailscale ?? false,
  };
}

function cfg(httpPartial: { host?: string; tailscale?: boolean }): DictaConfig {
  return { http: http(httpPartial) } as DictaConfig;
}

test('unspecified addresses include 0.0.0.0 and IPv6 any', () => {
  assert.equal(isUnspecifiedAddress('0.0.0.0'), true);
  assert.equal(isUnspecifiedAddress('::'), true);
  assert.equal(isUnspecifiedAddress('[::]'), true);
  assert.equal(isUnspecifiedAddress('*'), true);
  assert.equal(isUnspecifiedAddress('127.0.0.1'), false);
  assert.equal(isUnspecifiedAddress('100.64.1.2'), false);
});

test('API bind stays on loopback when Tailscale is on', () => {
  assert.equal(apiListenHost(cfg({ tailscale: true })), '127.0.0.1');
  assert.equal(apiListenHost(cfg({ host: '0.0.0.0', tailscale: true })), '127.0.0.1');
  assert.equal(apiListenHost(cfg({ host: '::', tailscale: true })), '127.0.0.1');
});

test('API bind keeps an explicit host when Tailscale is off', () => {
  assert.equal(apiListenHost(cfg({ host: '0.0.0.0', tailscale: false })), '0.0.0.0');
  assert.equal(apiListenHost(cfg({ host: '127.0.0.1', tailscale: false })), '127.0.0.1');
});
