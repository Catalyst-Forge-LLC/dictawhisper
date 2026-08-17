import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJSON } from '../src/lib/jsonLib.ts';

test('returns objects unchanged', async () => {
  const value = { cleanedTranscription: 'hello' };
  assert.equal(await parseJSON(value), value);
});

test('strips markdown fences', async () => {
  const parsed = await parseJSON('```json\n{"cleanedTranscription":"ok","tags":["a"]}\n```');
  assert.equal(parsed.cleanedTranscription, 'ok');
  assert.deepEqual(parsed.tags, ['a']);
});

test('keeps the first object when the model trails off', async () => {
  const parsed = await parseJSON('{"cleanedTranscription":"done","tags":[]} trailing prose');
  assert.equal(parsed.cleanedTranscription, 'done');
});
