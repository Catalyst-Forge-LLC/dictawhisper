#!/usr/bin/env node
/**
 * Idempotent LocalSlip claim. Missing CLI → warn, exit 0.
 * Usage: node scripts/ensure-lease.mjs <name> <port>
 */
import { spawnSync } from 'node:child_process';

const name = process.argv[2];
const port = process.argv[3];
if (!name || !port) {
	console.error('usage: node scripts/ensure-lease.mjs <name> <port>');
	process.exit(1);
}

const opt = { encoding: 'utf8', timeout: 8000, windowsHide: true, shell: process.platform === 'win32' };
const got = spawnSync('localslip', ['get', name], { ...opt, stdio: ['ignore', 'pipe', 'ignore'] });
if (got.status === 0 && String(got.stdout || '').trim()) {
	process.exit(0);
}
const claim = spawnSync('localslip', ['claim', name, '--port', port], { ...opt, stdio: 'inherit' });
if (claim.error || claim.status !== 0) {
	console.warn(`localslip: skip claim ${name} (install the CLI to pin this port to ${port})`);
}
