import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { checkoutDevEnv } from '../src/lib/devPorts.ts';

test('the actual UI config proxies every API route to the checkout-selected endpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dicta-checkout-proxy-'));
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ http: { port: 8008, host: '127.0.0.1', tailscale: false } }));
  try {
    // A publishing dashboard's PORT/HOST must not override this fixture's API lease.
    const env = checkoutDevEnv({ ...process.env, PATH: '', PORT: '', HOST: '', DICTA_TAILSCALE: '0' }, { port: 8008, host: '0.0.0.0', path: configPath }, 17777, 18008);
    const configUrl = pathToFileURL(resolve('client/vite.config.js')).href;
    const run = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `const {default: cfg} = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify({port:cfg.server.port, strict:cfg.server.strictPort, targets:Object.values(cfg.server.proxy).map(v=>v.target)}));`], { env, cwd: resolve('client'), encoding: 'utf8', timeout: 45000, windowsHide: true });
    assert.equal(run.status, 0, `${run.error?.message ?? ''}\n${run.stderr}`);
    const result = JSON.parse(run.stdout.trim());
    assert.equal(result.port, 17777);
    assert.equal(result.strict, true);
    assert.ok(result.targets.length > 0);
    assert.deepEqual([...new Set(result.targets)], ['http://127.0.0.1:18008']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
