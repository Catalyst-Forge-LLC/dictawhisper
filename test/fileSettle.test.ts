import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, getSettleMs } from '../src/lib/fileSettleLib.ts';

test('explicit settleMs wins over config', () => {
  assert.equal(getSettleMs(0), 0);
  assert.equal(getSettleMs(1500), 1500);
});

test('formatDuration uses compact units', () => {
  assert.equal(formatDuration(400), '400ms');
  assert.equal(formatDuration(12_000), '12s');
  assert.equal(formatDuration(30 * 60_000), '30m');
});
