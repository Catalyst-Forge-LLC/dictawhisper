import { spawnSync } from 'child_process';

/** `localslip get <name>` — undefined if the CLI or lease is missing. */
export function localslipGet(name: string): number | undefined {
  const result = spawnSync('localslip', ['get', name], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) return undefined;
  const n = Number((result.stdout || '').trim());
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
}
