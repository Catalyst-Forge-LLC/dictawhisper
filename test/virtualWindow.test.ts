import assert from 'node:assert/strict';
import { test } from 'node:test';
import { virtualSlice } from '../client/src/lib/virtualWindow.js';

test('virtual slice windows a long list around the scroll top', () => {
  const sizes = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, 100]));
  const slice = virtualSlice({
    count: 40,
    scrollTop: 1200,
    viewport: 400,
    sizes,
    estimate: 100,
    overscan: 2,
  });
  assert.ok(slice.start <= 12);
  assert.ok(slice.end >= 16);
  assert.ok(slice.end - slice.start < 20);
  assert.equal(slice.total, 4000);
});
