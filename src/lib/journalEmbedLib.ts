import { listTargets, ollamaBaseUrl, ollamaTags, resolveHost, type HostTarget } from 'ollanet';
import { config } from '../config.ts';
import { configuredMachine, resolveOllanetMachine } from './ollanetLib.ts';

const EMBED_NAME = /embed|nomic|mxbai|bge|e5|minilm|arctic/i;

export type EmbedClient = {
  model: string;
  baseUrl: string;
  host: string;
  embed(text: string): Promise<number[]>;
};

export type EmbedCandidate = {
  host: string;
  baseUrl: string;
  names: string[];
  local: boolean;
};

/** Which Ollama hosts may receive note text for embedding. */
export type EmbedHostMode =
  | { kind: 'local' }
  | { kind: 'any' }
  | { kind: 'named'; machine: string; setting: 'machine' | 'host' }
  | { kind: 'off'; reason: string };

export type EmbedSettings = {
  search: 'lex' | 'semantic' | 'hybrid';
  embedHost: string;
  embedModel: string;
  machine: string;
};

export type EmbedResolution = {
  client: EmbedClient | null;
  mode: EmbedHostMode;
  /** Plain reason semantic search is off; empty when a client was found. */
  reason: string;
};

export type EmbedDeps = {
  listTargets: () => Promise<HostTarget[]>;
  ollamaTags: (baseUrl: string, timeoutMs: number) => Promise<{ name: string }[]>;
  resolveMachine: (machine: string) => Promise<HostTarget>;
};

const defaultDeps: EmbedDeps = {
  listTargets: () => listTargets(),
  ollamaTags,
  resolveMachine: resolveOllanetMachine,
};

export function embedSettingsFromConfig(): EmbedSettings {
  return {
    search: config.journal.search,
    embedHost: config.journal.embedHost,
    embedModel: config.journal.embedModel,
    machine: config.ollanet.machine,
  };
}

export function embedHostMode(settings: EmbedSettings): EmbedHostMode {
  if (settings.search === 'lex') {
    return { kind: 'off', reason: 'journal.search is lex; nothing is embedded' };
  }
  const raw = settings.embedHost.trim();
  const key = raw.toLowerCase();
  if (!key || key === 'local') return { kind: 'local' };
  if (key === 'any') return { kind: 'any' };
  if (key === 'machine') {
    const machine = configuredMachine(settings.machine);
    if (!machine) {
      return { kind: 'off', reason: 'journal.embedHost is machine but ollanet.machine is not set' };
    }
    return { kind: 'named', machine, setting: 'machine' };
  }
  return { kind: 'named', machine: raw, setting: 'host' };
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/i;

export function isLocalTarget(target: Pick<HostTarget, 'isSelf' | 'source' | 'ip' | 'dnsName'>): boolean {
  return Boolean(
    target.isSelf || target.source === 'localhost' || LOOPBACK.test(target.ip) || LOOPBACK.test(target.dnsName),
  );
}

/** Hosts the mode allows, local first. Named hosts match the way ollanet resolves `ollanet.machine`. */
export function allowedEmbedTargets(targets: HostTarget[], mode: EmbedHostMode): HostTarget[] {
  if (mode.kind === 'off') return [];
  if (mode.kind === 'local') return targets.filter(isLocalTarget);
  if (mode.kind === 'named') {
    try {
      return [resolveHost(targets, mode.machine)];
    } catch {
      return [];
    }
  }
  return [...targets].sort((a, b) => Number(isLocalTarget(b)) - Number(isLocalTarget(a)));
}

export function modelMatchesPreferred(name: string, preferred: string): boolean {
  const want = preferred.trim();
  if (!want) return false;
  return name === want || name.startsWith(`${want}:`) || name.startsWith(`${want}-`);
}

export function pickEmbedName(names: string[], preferred = ''): string | null {
  const want = preferred.trim();
  if (want) {
    const hit = names.find((name) => modelMatchesPreferred(name, want));
    if (hit) return hit;
  }
  return names.find((name) => EMBED_NAME.test(name)) || null;
}

/** Pick an embed model among candidates the mode allows. `local` never returns a remote row. */
export function pickEmbedTarget(
  candidates: EmbedCandidate[],
  mode: EmbedHostMode,
  preferred = '',
): (EmbedCandidate & { model: string }) | null {
  if (mode.kind === 'off') return null;
  const allowed = mode.kind === 'local' ? candidates.filter((row) => row.local) : candidates;
  const ranked = [...allowed].sort((a, b) => Number(b.local) - Number(a.local));
  if (preferred.trim()) {
    for (const row of ranked) {
      const model = pickEmbedName(row.names, preferred);
      if (model && modelMatchesPreferred(model, preferred)) return { ...row, model };
    }
  }
  for (const row of ranked) {
    const model = pickEmbedName(row.names, preferred);
    if (model) return { ...row, model };
  }
  return null;
}

function hostLabel(host: HostTarget): string {
  return host.hostname || host.dnsName || host.ip;
}

function noModelReason(mode: EmbedHostMode, preferred: string): string {
  const what = preferred ? `embedding model ${preferred}` : 'embedding model';
  if (mode.kind === 'off') return mode.reason;
  if (mode.kind === 'local') {
    return `no ${what} on this computer; set journal.embedHost to use another host`;
  }
  if (mode.kind === 'named') return `no ${what} on ${mode.machine}, the journal.embedHost host`;
  return `no ${what} on this computer or any ollanet host`;
}

export async function resolveEmbedClient(
  settings: EmbedSettings = embedSettingsFromConfig(),
  deps: EmbedDeps = defaultDeps,
): Promise<EmbedResolution> {
  const mode = embedHostMode(settings);
  if (mode.kind === 'off') return { client: null, mode, reason: mode.reason };

  let hosts: HostTarget[] = [];
  if (mode.kind === 'named') {
    try {
      hosts = [await deps.resolveMachine(mode.machine)];
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return { client: null, mode, reason: `journal.embedHost ${mode.machine} is unreachable (${detail})` };
    }
  } else {
    try {
      hosts = allowedEmbedTargets(await deps.listTargets(), mode);
    } catch {
      hosts = [];
    }
  }

  const want = settings.embedModel.trim();
  const candidates: EmbedCandidate[] = [];
  let picked: (EmbedCandidate & { model: string }) | null = null;
  for (const host of hosts) {
    const baseUrl = ollamaBaseUrl(host);
    try {
      const tags = await deps.ollamaTags(baseUrl, 8_000);
      candidates.push({
        host: hostLabel(host),
        baseUrl,
        names: tags.map((tag) => tag.name),
        local: isLocalTarget(host),
      });
    } catch {
      continue;
    }
    const soFar = pickEmbedTarget(candidates, mode, want);
    if (soFar && (!want || modelMatchesPreferred(soFar.model, want))) {
      picked = soFar;
      break;
    }
  }
  picked = picked || pickEmbedTarget(candidates, mode, want);
  if (!picked) return { client: null, mode, reason: noModelReason(mode, want) };

  const { baseUrl, model, host } = picked;
  return {
    mode,
    reason: '',
    client: {
      model,
      baseUrl,
      host,
      async embed(text: string) {
        return embedWithOllama(baseUrl, model, text);
      },
    },
  };
}

export async function createEmbedClient(settings?: EmbedSettings): Promise<EmbedClient | null> {
  return (await resolveEmbedClient(settings)).client;
}

export async function embedWithOllama(baseUrl: string, model: string, text: string): Promise<number[]> {
  const clipped = text.slice(0, 8000);
  const modern = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: clipped }),
  });
  if (modern.ok) {
    const json = (await modern.json()) as { embeddings?: number[][]; embedding?: number[] };
    const vector = json.embeddings?.[0] || json.embedding;
    if (Array.isArray(vector) && vector.length) return vector;
  }
  const legacy = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: clipped }),
  });
  if (!legacy.ok) {
    throw new Error(`ollama embed ${legacy.status} ${await legacy.text().catch(() => '')}`);
  }
  const json = (await legacy.json()) as { embedding?: number[] };
  if (!Array.isArray(json.embedding) || !json.embedding.length) {
    throw new Error('ollama embed returned no vector');
  }
  return json.embedding;
}
