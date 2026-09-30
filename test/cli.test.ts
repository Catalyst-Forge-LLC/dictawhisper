import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.ts');

test('cli --help explains init, doctor, and start', () => {
	const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, '--help'], {
		encoding: 'utf8',
		cwd: root,
		windowsHide: true,
	});
	assert.equal(result.status, 0);
	assert.match(result.stdout, /dictawhisper init/);
	assert.match(result.stdout, /dictawhisper doctor/);
	assert.match(result.stdout, /dictawhisper start/);
});

for (const command of ['start', 'doctor']) {
	test(`cli ${command} refuses an explicitly missing config before launching a runtime`, () => {
		const work = mkdtempSync(join(tmpdir(), 'dicta-missing-config-'));
		const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, command], {
			encoding: 'utf8', cwd: work, windowsHide: true, timeout: 30000,
			env: { ...process.env, DICTA_CONFIG: join(work, 'missing.json') },
		});
		assert.equal(result.status, 1, result.error?.message ?? result.stderr);
		assert.match(result.stderr, /No config.json/);
		assert.deepEqual(readdirSync(work), []);
	});
}
