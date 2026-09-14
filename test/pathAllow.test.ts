import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { config } from '../src/config.ts';
import { resolveAllowedPath } from '../src/lib/pathAllowLib.ts';

test('allows a path under the browser drop folder', () => {
  const candidate = path.join(config.watch.browserDropFolder, 'clip.webm');
  const allowed = resolveAllowedPath(candidate);
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(path.resolve(allowed.path), path.resolve(candidate));
});

test('rejects a path outside every watch root', () => {
  const outside = path.join(os.tmpdir(), 'dicta-allowlist-should-reject', 'nope.wav');
  const allowed = resolveAllowedPath(outside);
  assert.equal(allowed.ok, false);
});

test('rejects a null byte in the path', () => {
  const candidate = `${path.join(config.watch.browserDropFolder, 'clip.webm')}\0.json`;
  const allowed = resolveAllowedPath(candidate);
  assert.equal(allowed.ok, false);
});

test('does not treat a sibling of a watch root as inside it', () => {
  const drop = path.resolve(config.watch.browserDropFolder);
  const sibling = `${drop}-evil${path.sep}clip.webm`;
  const allowed = resolveAllowedPath(sibling);
  assert.equal(allowed.ok, false);
});
