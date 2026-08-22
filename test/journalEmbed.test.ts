import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickEmbedName, pickEmbedTarget } from '../src/lib/journalEmbedLib.ts';

test('pickEmbedName matches nomic-embed-text-v2-moe', () => {
  assert.equal(
    pickEmbedName(['qwen3.8:27b-mlx', 'nomic-embed-text-v2-moe:latest', 'gemma4:31b-mlx']),
    'nomic-embed-text-v2-moe:latest',
  );
});

test('pickEmbedTarget prefers a local embed host over a remote chat box', () => {
  const picked = pickEmbedTarget([
    { host: 'sams-macbook-pro', baseUrl: 'http://mac:11434', names: ['qwen3.8:27b-mlx'], local: false },
    {
      host: 'this-pc',
      baseUrl: 'http://127.0.0.1:11434',
      names: ['gemma4:12b', 'nomic-embed-text-v2-moe:latest'],
      local: true,
    },
  ]);
  assert.ok(picked);
  assert.equal(picked.model, 'nomic-embed-text-v2-moe:latest');
  assert.equal(picked.baseUrl, 'http://127.0.0.1:11434');
});

test('pickEmbedTarget honors journal.embedModel on any host', () => {
  const picked = pickEmbedTarget(
    [
      { host: 'this-pc', baseUrl: 'http://127.0.0.1:11434', names: ['nomic-embed-text-v2-moe:latest'], local: true },
      { host: 'mac', baseUrl: 'http://mac:11434', names: ['mxbai-embed-large'], local: false },
    ],
    'mxbai-embed-large',
  );
  assert.ok(picked);
  assert.equal(picked.model, 'mxbai-embed-large');
  assert.equal(picked.host, 'mac');
});
