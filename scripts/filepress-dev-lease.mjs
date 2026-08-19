#!/usr/bin/env node
/** Pin FilePress to the LocalBerth slip until getfilepress ships resolvePort. */
import { spawnSync } from 'node:child_process';

const name = 'dictawhisper-site';
const fallback = 5186;
const opt = { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: process.platform === 'win32' };
const got = spawnSync('localberth', ['get', name], { ...opt, stdio: ['ignore', 'pipe', 'ignore'] });
const n = Number(String(got.stdout || '').trim());
process.env.FILEPRESS_PORT =
	process.env.FILEPRESS_PORT?.trim() ||
	(got.status === 0 && Number.isInteger(n) && n > 0 ? String(n) : String(fallback));

const r = spawnSync('filepress', process.argv.slice(2), {
	stdio: 'inherit',
	shell: process.platform === 'win32',
	env: process.env
});
process.exit(r.status ?? 1);
