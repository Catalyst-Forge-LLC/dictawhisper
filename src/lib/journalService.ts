import { config } from '../config.ts';
import {
  getJournalIndex,
  JournalIndex,
  openJournalIndex,
  setJournalIndex,
  type IndexListOptions,
  type IndexSearchHit,
  type SearchMode,
} from './journalIndexLib.ts';
import { createEmbedClient, type EmbedClient } from './journalEmbedLib.ts';

let embedClient: EmbedClient | null = null;
let embedChain: Promise<void> = Promise.resolve();
let rebuilding = false;

export function journalIndexPath(): string {
  return config.journal.index;
}

export function journalReady(): boolean {
  return Boolean(getJournalIndex());
}

export function journalRebuilding(): boolean {
  return rebuilding;
}

export function initJournalIndex(): JournalIndex {
  const existing = getJournalIndex();
  if (existing) return existing;
  const index = openJournalIndex(journalIndexPath());
  setJournalIndex(index);
  return index;
}

export function requireJournal(): JournalIndex {
  return getJournalIndex() || initJournalIndex();
}

export { getJournalIndex };

export async function startJournalIndex(roots: string[]): Promise<void> {
  const index = initJournalIndex();
  const stats = index.stats();
  if (stats.notes === 0) {
    console.log('[journal-index] empty; rebuilding FTS from disk');
    await rebuildJournalIndex(roots, { embed: false });
    void ensureEmbeddings(index);
    return;
  }
  console.log(
    `[journal-index] ${stats.notes} notes (${stats.embedded} embedded) at ${stats.path}`,
  );
  void ensureEmbeddings(index);
}

export async function rebuildJournalIndex(
  roots: string[],
  options: { embed?: boolean } = {},
): Promise<{ upserted: number; removed: number; embedded: number }> {
  const index = requireJournal();
  rebuilding = true;
  try {
    const result = index.rebuildFromRoots(roots);
    console.log(`[journal-index] rebuilt upserted=${result.upserted} removed=${result.removed}`);
    let embedded = 0;
    if (options.embed !== false) {
      embedded = await ensureEmbeddings(index);
    }
    return { ...result, embedded };
  } finally {
    rebuilding = false;
  }
}

export function indexSidecar(jsonFile: string) {
  try {
    const index = getJournalIndex();
    if (!index) return;
    const result = index.upsertSidecar(jsonFile);
    if (result?.changed && !result.skipEmbed) {
      queueEmbed(index, result.rowid, jsonFile);
    }
  } catch (error) {
    console.warn(`[journal-index] upsert failed: ${error instanceof Error ? error.message : error}`);
  }
}

export function dropSidecar(jsonFile: string) {
  try {
    getJournalIndex()?.removeSidecar(jsonFile);
  } catch (error) {
    console.warn(`[journal-index] remove failed: ${error instanceof Error ? error.message : error}`);
  }
}

function queueEmbed(index: JournalIndex, rowid: number, jsonFile: string) {
  embedChain = embedChain
    .then(async () => {
      const client = await getEmbedClient();
      if (!client) return;
      const row = index.rowsNeedingEmbed().find((item) => item.rowid === rowid);
      const text = row?.body;
      if (!text) return;
      await embedOne(index, client, rowid, text);
    })
    .catch((error) => {
      console.warn(`[journal-index] embed ${jsonFile}: ${error instanceof Error ? error.message : error}`);
    });
}

async function getEmbedClient(): Promise<EmbedClient | null> {
  if (embedClient) return embedClient;
  embedClient = await createEmbedClient();
  if (embedClient) {
    console.log(`[journal-index] ollama embed model ${embedClient.model}`);
  }
  return embedClient;
}

async function embedOne(index: JournalIndex, client: EmbedClient, rowid: number, text: string) {
  const vector = await client.embed(text);
  index.ensureVec(vector.length, client.model);
  index.putEmbedding(rowid, vector);
}

export async function ensureEmbeddings(index: JournalIndex = requireJournal()): Promise<number> {
  const client = await getEmbedClient();
  if (!client) {
    console.log('[journal-index] no ollama embedding model; FTS-only');
    return 0;
  }
  const pending = index.rowsNeedingEmbed();
  if (!pending.length) return 0;
  console.log(`[journal-index] embedding ${pending.length} notes with ${client.model}`);
  let done = 0;
  for (const row of pending) {
    try {
      await embedOne(index, client, row.rowid, row.body);
      done += 1;
      if (done % 25 === 0) console.log(`[journal-index] embedded ${done}/${pending.length}`);
    } catch (error) {
      console.warn(
        `[journal-index] embed failed ${row.json_file}: ${error instanceof Error ? error.message : error}`,
      );
      break;
    }
  }
  return done;
}

export async function searchJournalIndex(options: {
  query?: string;
  tags?: string[];
  since?: string;
  until?: string;
  mode?: SearchMode;
  limit?: number;
  unreadable?: boolean;
}): Promise<IndexSearchHit[]> {
  const index = requireJournal();
  const requested = options.mode || config.journal.search;
  let queryEmbedding: number[] | null = null;
  if (requested !== 'lex' && String(options.query || '').trim()) {
    try {
      const client = await getEmbedClient();
      if (client) queryEmbedding = await client.embed(String(options.query));
    } catch (error) {
      console.warn(`[journal-index] query embed failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return index.search({ ...options, mode: requested, queryEmbedding });
}

export function listInboxNotes(options: IndexListOptions = {}) {
  return requireJournal().list(options).map(toInboxSummary);
}

export function notesIndexPayload(fallback: () => unknown[]) {
  const index = getJournalIndex();
  if (index && index.stats().notes > 0) {
    return { notes: index.list().map(toInboxSummary), paged: true, indexing: rebuilding };
  }
  return { notes: fallback(), paged: false, indexing: rebuilding };
}

export function journalYears() {
  return requireJournal().years();
}

export function journalTags(options: { includeSingletons?: boolean; limit?: number } = {}) {
  return requireJournal().tags(options);
}

export function journalStats() {
  const index = requireJournal();
  return { ...index.stats(), indexing: rebuilding, vec: index.hasVec() };
}

export function recentJournalIndex(options: {
  limit?: number;
  tags?: string[];
  since?: string;
  until?: string;
} = {}) {
  return requireJournal().recent(options);
}

export function toInboxSummary(hit: {
  jsonFile: string;
  basename: string;
  tags: string[];
  preview: string;
  hasCleaned: boolean;
  audioError: string | null;
}) {
  return {
    jsonFile: hit.jsonFile,
    basename: hit.basename,
    transcriptionJson: {
      tags: hit.tags,
      preview: hit.preview,
      hasCleaned: hit.hasCleaned,
      audioError: hit.audioError,
      _partial: true,
    },
  };
}
