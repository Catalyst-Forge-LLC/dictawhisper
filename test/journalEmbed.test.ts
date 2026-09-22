import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostTarget } from 'ollanet';
import {
  allowedEmbedTargets,
  embedHostMode,
  isLocalTarget,
  pickEmbedName,
  pickEmbedTarget,
  resolveEmbedClient,
  type EmbedDeps,
  type EmbedSettings,
} from '../src/lib/journalEmbedLib.ts';

function host(partial: Partial<HostTarget> & { hostname: string; ip: string }): HostTarget {
  return { dnsName: '', online: true, os: 'unknown', isSelf: false, source: 'tailscale', port: 11434, ...partial };
}

const self = host({ hostname: 'this-pc', dnsName: 'localhost', ip: '127.0.0.1', isSelf: true, source: 'localhost' });
const tailSelf = host({ hostname: 'this-pc', dnsName: 'this-pc.tail.ts.net.', ip: '100.64.0.1', isSelf: true });
const mac = host({ hostname: 'sams-macbook-pro', dnsName: 'sams-macbook-pro.tail.ts.net', ip: '100.64.0.2' });
const studio = host({ hostname: 'studio', ip: '192.168.1.40', source: 'config' });
const loopbackConfig = host({ hostname: 'my-ollama', ip: '127.0.0.1', source: 'config', port: 11500 });

function settings(partial: Partial<EmbedSettings> = {}): EmbedSettings {
  return { search: 'hybrid', embedHost: 'local', embedModel: '', machine: '', ...partial };
}

function fakeDeps(tagsByIp: Record<string, string[]>, targets: HostTarget[] = [self, mac, studio]) {
  const calls = { listTargets: 0, tags: [] as string[], resolveMachine: [] as string[] };
  const deps: EmbedDeps = {
    async listTargets() {
      calls.listTargets += 1;
      return targets;
    },
    async ollamaTags(baseUrl) {
      calls.tags.push(baseUrl);
      const ip = new URL(baseUrl).hostname;
      const names = tagsByIp[ip];
      if (!names) throw new Error('offline');
      return names.map((name) => ({ name }));
    },
    async resolveMachine(machine) {
      calls.resolveMachine.push(machine);
      const hit = targets.find((row) => row.hostname === machine || row.ip === machine);
      if (!hit) throw new Error(`Unknown machine "${machine}".`);
      return hit;
    },
  };
  return { deps, calls };
}

test('pickEmbedName matches nomic-embed-text-v2-moe', () => {
  assert.equal(
    pickEmbedName(['qwen3.8:27b-mlx', 'nomic-embed-text-v2-moe:latest', 'gemma4:31b-mlx']),
    'nomic-embed-text-v2-moe:latest',
  );
});

test('embedHostMode defaults to local and reads machine, any, and named hosts', () => {
  assert.deepEqual(embedHostMode(settings({ embedHost: '' })), { kind: 'local' });
  assert.deepEqual(embedHostMode(settings({ embedHost: 'LOCAL' })), { kind: 'local' });
  assert.deepEqual(embedHostMode(settings({ embedHost: 'any' })), { kind: 'any' });
  assert.deepEqual(embedHostMode(settings({ embedHost: 'machine', machine: 'studio' })), {
    kind: 'named',
    machine: 'studio',
    setting: 'machine',
  });
  assert.deepEqual(embedHostMode(settings({ embedHost: 'Studio' })), {
    kind: 'named',
    machine: 'Studio',
    setting: 'host',
  });
});

test('embedHostMode is off for lex search and for machine with no ollanet.machine', () => {
  assert.equal(embedHostMode(settings({ search: 'lex', embedHost: 'any' })).kind, 'off');
  assert.equal(embedHostMode(settings({ embedHost: 'machine', machine: '' })).kind, 'off');
  assert.equal(embedHostMode(settings({ embedHost: 'machine', machine: 'YOUR-OLLANET-HOST' })).kind, 'off');
});

test('isLocalTarget covers isSelf, localhost source, and loopback addresses', () => {
  assert.equal(isLocalTarget(self), true);
  assert.equal(isLocalTarget(tailSelf), true);
  assert.equal(isLocalTarget(loopbackConfig), true);
  assert.equal(isLocalTarget(mac), false);
  assert.equal(isLocalTarget(studio), false);
});

test('allowedEmbedTargets: local keeps only this computer', () => {
  const allowed = allowedEmbedTargets([mac, self, studio, tailSelf], { kind: 'local' });
  assert.deepEqual(allowed.map((row) => row.ip), ['127.0.0.1', '100.64.0.1']);
});

test('allowedEmbedTargets: named matches one host the way ollanet.machine does', () => {
  assert.deepEqual(
    allowedEmbedTargets([self, mac, studio], { kind: 'named', machine: 'sams-macbook-pro', setting: 'host' }),
    [mac],
  );
  assert.deepEqual(
    allowedEmbedTargets([self, mac, studio], { kind: 'named', machine: 'nope', setting: 'host' }),
    [],
  );
});

test('allowedEmbedTargets: any keeps every host, local first; off keeps none', () => {
  const any = allowedEmbedTargets([mac, studio, self], { kind: 'any' });
  assert.equal(any.length, 3);
  assert.equal(any[0], self);
  assert.deepEqual(allowedEmbedTargets([self, mac], { kind: 'off', reason: 'x' }), []);
});

test('pickEmbedTarget in local mode never returns a remote row', () => {
  const rows = [
    { host: 'mac', baseUrl: 'http://mac:11434', names: ['nomic-embed-text'], local: false },
    { host: 'this-pc', baseUrl: 'http://127.0.0.1:11434', names: ['gemma4:12b'], local: true },
  ];
  assert.equal(pickEmbedTarget(rows, { kind: 'local' }), null);
  assert.equal(pickEmbedTarget(rows, { kind: 'any' })?.host, 'mac');
  assert.equal(pickEmbedTarget(rows, { kind: 'off', reason: 'x' }), null);
});

test('pickEmbedTarget prefers a local embed host over a remote one', () => {
  const picked = pickEmbedTarget(
    [
      { host: 'sams-macbook-pro', baseUrl: 'http://mac:11434', names: ['nomic-embed-text'], local: false },
      {
        host: 'this-pc',
        baseUrl: 'http://127.0.0.1:11434',
        names: ['gemma4:12b', 'nomic-embed-text-v2-moe:latest'],
        local: true,
      },
    ],
    { kind: 'any' },
  );
  assert.ok(picked);
  assert.equal(picked.model, 'nomic-embed-text-v2-moe:latest');
  assert.equal(picked.baseUrl, 'http://127.0.0.1:11434');
});

test('pickEmbedTarget honors journal.embedModel across allowed hosts', () => {
  const picked = pickEmbedTarget(
    [
      { host: 'this-pc', baseUrl: 'http://127.0.0.1:11434', names: ['nomic-embed-text-v2-moe:latest'], local: true },
      { host: 'mac', baseUrl: 'http://mac:11434', names: ['mxbai-embed-large'], local: false },
    ],
    { kind: 'any' },
    'mxbai-embed-large',
  );
  assert.ok(picked);
  assert.equal(picked.model, 'mxbai-embed-large');
  assert.equal(picked.host, 'mac');
});

test('resolveEmbedClient local: uses this computer when it has a model', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['nomic-embed-text'], '100.64.0.2': ['mxbai-embed-large'] });
  const result = await resolveEmbedClient(settings(), deps);
  assert.equal(result.client?.baseUrl, 'http://127.0.0.1:11434');
  assert.deepEqual(calls.tags, ['http://127.0.0.1:11434']);
});

test('resolveEmbedClient local: no local model means off, and no remote host is contacted', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['gemma4:12b'], '100.64.0.2': ['nomic-embed-text'] });
  const result = await resolveEmbedClient(settings(), deps);
  assert.equal(result.client, null);
  assert.match(result.reason, /no embedding model on this computer; set journal\.embedHost/);
  assert.deepEqual(calls.tags, ['http://127.0.0.1:11434']);
});

test('resolveEmbedClient machine: uses ollanet.machine only', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['nomic-embed-text'], '192.168.1.40': ['bge-m3'] });
  const result = await resolveEmbedClient(settings({ embedHost: 'machine', machine: 'studio' }), deps);
  assert.equal(result.client?.host, 'studio');
  assert.equal(result.client?.model, 'bge-m3');
  assert.deepEqual(calls.resolveMachine, ['studio']);
  assert.deepEqual(calls.tags, ['http://192.168.1.40:11434']);
});

test('resolveEmbedClient machine: empty ollanet.machine means no host at all', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['nomic-embed-text'] });
  const result = await resolveEmbedClient(settings({ embedHost: 'machine', machine: '' }), deps);
  assert.equal(result.client, null);
  assert.match(result.reason, /ollanet\.machine is not set/);
  assert.equal(calls.listTargets, 0);
  assert.deepEqual(calls.tags, []);
});

test('resolveEmbedClient named host: no model there does not fall back to other hosts', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['nomic-embed-text'], '100.64.0.2': ['qwen3.8:27b'] });
  const result = await resolveEmbedClient(settings({ embedHost: 'sams-macbook-pro' }), deps);
  assert.equal(result.client, null);
  assert.match(result.reason, /no embedding model on sams-macbook-pro/);
  assert.deepEqual(calls.tags, ['http://100.64.0.2:11434']);
});

test('resolveEmbedClient named host: unknown host is reported, not guessed', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['nomic-embed-text'] });
  const result = await resolveEmbedClient(settings({ embedHost: 'nowhere' }), deps);
  assert.equal(result.client, null);
  assert.match(result.reason, /journal\.embedHost nowhere is unreachable/);
  assert.deepEqual(calls.tags, []);
});

test('resolveEmbedClient any: falls through to a discovered host', async () => {
  const { deps } = fakeDeps({ '127.0.0.1': ['gemma4:12b'], '100.64.0.2': ['nomic-embed-text'] });
  const result = await resolveEmbedClient(settings({ embedHost: 'any' }), deps);
  assert.equal(result.client?.host, 'sams-macbook-pro');
});

test('resolveEmbedClient lex: no discovery, no tags, no client', async () => {
  const { deps, calls } = fakeDeps({ '127.0.0.1': ['nomic-embed-text'] });
  const result = await resolveEmbedClient(settings({ search: 'lex', embedHost: 'any' }), deps);
  assert.equal(result.client, null);
  assert.equal(result.mode.kind, 'off');
  assert.equal(calls.listTargets, 0);
  assert.deepEqual(calls.resolveMachine, []);
  assert.deepEqual(calls.tags, []);
});
