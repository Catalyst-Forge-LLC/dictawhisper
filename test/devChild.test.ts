import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnDevChild } from '../src/lib/devChild.ts';
import { checkoutDevEnv } from '../src/lib/devPorts.ts';

test('standalone child receives matching endpoints with a clean PATH and reports its failure', async () => {
  const env = checkoutDevEnv({ PATH: '', SystemRoot: process.env.SystemRoot }, { port: 9008, host: '127.0.0.1', path: '/fixture/config.json' });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child failed to finish')), 5000);
    spawnDevChild(process.execPath, ['-e', `if (process.env.PORT !== process.env.DICTA_API_PORT || process.env.DICTA_UI_PORT !== '7777') process.exit(99); console.error('fixture child failure'); process.exit(7);`], env, true, (message, code) => {
      clearTimeout(timer);
      try { assert.equal(code, 7); assert.match(message, /exited 7/); resolve(); } catch (error) { reject(error); }
    });
  });
});

test('missing child command produces a visible startup reason', async () => {
  await new Promise<void>((resolve, reject) => {
    spawnDevChild('dicta-missing-fixture-executable', [], { PATH: '' }, true, (message, code) => {
      try { assert.equal(code, 1); assert.match(message, /failed to start.*ENOENT/); resolve(); } catch (error) { reject(error); }
    });
  });
});
