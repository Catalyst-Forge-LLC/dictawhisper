import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
