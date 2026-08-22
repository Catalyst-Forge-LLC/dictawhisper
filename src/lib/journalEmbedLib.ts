import { listTargets, ollamaBaseUrl, ollamaTags } from 'ollanet';
import { config } from '../config.ts';

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

/** Prefer a local box, then any ollanet host that has an embed-class model. */
export function pickEmbedTarget(candidates: EmbedCandidate[], preferred = ''): EmbedCandidate & { model: string } | null {
  const ranked = [...candidates].sort((a, b) => Number(b.local) - Number(a.local));
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

export async function createEmbedClient(preferredModel = config.journal.embedModel): Promise<EmbedClient | null> {
  let targets: Awaited<ReturnType<typeof listTargets>> = [];
  try {
    targets = await listTargets();
  } catch {
    return null;
  }
  const ordered = [...targets].sort(
    (a, b) => Number(b.isSelf || b.source === 'localhost') - Number(a.isSelf || a.source === 'localhost'),
  );
  const candidates: EmbedCandidate[] = [];
  const want = preferredModel.trim();
  for (const host of ordered) {
    const baseUrl = ollamaBaseUrl(host);
    try {
      const tags = await ollamaTags(baseUrl, 8_000);
      candidates.push({
        host: host.hostname || host.dnsName || host.ip,
        baseUrl,
        names: tags.map((tag: { name: string }) => tag.name),
        local: Boolean(host.isSelf || host.source === 'localhost'),
      });
      const pickedSoFar = pickEmbedTarget(candidates, preferredModel);
      if (!pickedSoFar) continue;
      if (want && !modelMatchesPreferred(pickedSoFar.model, want)) continue;
      if (pickedSoFar.local || !want) {
        return {
          model: pickedSoFar.model,
          baseUrl: pickedSoFar.baseUrl,
          host: pickedSoFar.host,
          async embed(text: string) {
            return embedWithOllama(pickedSoFar.baseUrl, pickedSoFar.model, text);
          },
        };
      }
    } catch {
      // host offline or not serving Ollama
    }
  }
  const picked = pickEmbedTarget(candidates, preferredModel);
  if (!picked) return null;
  return {
    model: picked.model,
    baseUrl: picked.baseUrl,
    host: picked.host,
    async embed(text: string) {
      return embedWithOllama(picked.baseUrl, picked.model, text);
    },
  };
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
