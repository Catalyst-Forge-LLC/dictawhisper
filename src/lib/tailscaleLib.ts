import { spawnSync } from 'child_process';
import type { DictaConfig } from '../config.ts';

export const UI_PORT = 7777;

export type TailscaleSelf = {
  ip: string;
  dnsName: string;
};

function runTailscale(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('tailscale', args, {
    encoding: 'utf8',
    timeout: 8_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { ok: false, stdout: (result.stdout || '').trim() };
  }
  return { ok: true, stdout: (result.stdout || '').trim() };
}

export function discoverTailscale(): TailscaleSelf | null {
  const ipRun = runTailscale(['ip', '-4']);
  if (!ipRun.ok) return null;
  const ip = ipRun.stdout.split(/\s+/)[0]?.trim();
  if (!ip) return null;

  let dnsName = '';
  const statusRun = runTailscale(['status', '--json']);
  if (statusRun.ok) {
    try {
      const status = JSON.parse(statusRun.stdout) as { Self?: { DNSName?: string } };
      dnsName = String(status.Self?.DNSName || '').replace(/\.$/, '');
    } catch {
      dnsName = '';
    }
  }

  return { ip, dnsName };
}

export function apiListenHost(config: DictaConfig): string {
  return config.http.tailscale ? '0.0.0.0' : config.http.host;
}

export function tailscaleOrigins(self: TailscaleSelf, uiPort = UI_PORT): string[] {
  const origins = [`http://${self.ip}:${uiPort}`];
  if (self.dnsName) origins.push(`http://${self.dnsName}:${uiPort}`);
  return origins;
}

export function resolvedCorsOrigins(config: DictaConfig, self: TailscaleSelf | null = null): string[] {
  const origins = new Set(config.http.corsOrigins);
  if (config.http.tailscale) {
    const info = self ?? discoverTailscale();
    if (info) {
      for (const origin of tailscaleOrigins(info)) origins.add(origin);
    }
  }
  return [...origins];
}

export function inboxUrls(config: DictaConfig, self: TailscaleSelf | null): string[] {
  const urls = [`http://127.0.0.1:${UI_PORT}`, `http://localhost:${UI_PORT}`];
  if (config.http.tailscale && self) {
    urls.push(...tailscaleOrigins(self).map((origin) => origin));
  }
  return [...new Set(urls)];
}
