import { ollamaBaseUrl, ollamaTags, resolveTarget } from 'ollanet';
import { config } from '../config.ts';
import { ollanetIsConfigured } from './ollanetReadyLib.ts';

const EMBED_NAME = /embed|nomic|mxbai|bge|e5|minilm|arctic/i;

export type EmbedClient = {
  model: string;
  baseUrl: string;
  embed(text: string): Promise<number[]>;
};

export async function resolveOllamaBase(): Promise<string | null> {
  if (!ollanetIsConfigured()) return null;
  try {
    const host = await resolveTarget(config.ollanet.machine);
    return ollamaBaseUrl(host);
  } catch {
    return null;
  }
}

export async function pickEmbedModel(baseUrl: string, preferred = ''): Promise<string | null> {
  const want = preferred.trim();
  try {
    const tags = await ollamaTags(baseUrl, 8_000);
    const names = tags.map((tag: { name: string }) => tag.name);
    if (want && names.some((name) => name === want || name.startsWith(`${want}:`) || name.startsWith(`${want}-`))) {
      return names.find((name) => name === want || name.startsWith(`${want}:`) || name.startsWith(`${want}-`)) || want;
    }
    const hit = names.find((name) => EMBED_NAME.test(name));
    return hit || null;
  } catch {
    return want || null;
  }
}

export async function createEmbedClient(preferredModel = config.journal.embedModel): Promise<EmbedClient | null> {
  const baseUrl = await resolveOllamaBase();
  if (!baseUrl) return null;
  const model = await pickEmbedModel(baseUrl, preferredModel);
  if (!model) return null;
  return {
    model,
    baseUrl,
    async embed(text: string) {
      return embedWithOllama(baseUrl, model, text);
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
