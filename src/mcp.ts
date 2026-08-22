import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './config.ts';
import { allowedRoots } from './lib/pathAllowLib.ts';
import { dictawhisperVersion } from './lib/cleanupProvenanceLib.ts';
import {
  getJournalNote,
  listJournalTags,
  loadJournalNotes,
  recentJournal,
  searchJournal,
} from './lib/journalQueryLib.ts';
import {
  getJournalIndex,
  initJournalIndex,
  journalTags,
  recentJournalIndex,
  searchJournalIndex,
} from './lib/journalService.ts';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

function jsonText(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function loadNotes() {
  return loadJournalNotes(allowedRoots());
}

function readyIndex() {
  try {
    const index = getJournalIndex() || initJournalIndex();
    return index.stats().notes > 0 ? index : null;
  } catch {
    return null;
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'dictawhisper',
    version: dictawhisperVersion(),
    description:
      'Read-only voice journal. Search and fetch notes from sidecar JSON on disk. There are no write tools.',
  });

  server.registerTool(
    'dictawhisper_search',
    {
      description:
        'Search voice notes by words, tags, or filename. Returns paths, dates, tags, and a short preview. Use dictawhisper_get_note for the full cleaned text.',
      inputSchema: {
        query: z.string().optional().describe('Words to search in cleaned text, tags, or filename'),
        tags: z.array(z.string()).optional().describe('AND filter: note must have all of these tags'),
        since: z.string().optional().describe('Inclusive start day YYYY-MM-DD'),
        until: z.string().optional().describe('Inclusive end day YYYY-MM-DD'),
        limit: z.number().int().min(1).max(50).optional().describe('Max hits (default 10)'),
        mode: z.enum(['lex', 'semantic', 'hybrid']).optional().describe('Search mode (default from config)'),
      },
      annotations: readOnly,
    },
    async ({ query, tags, since, until, limit, mode }) => {
      if (!String(query || '').trim() && !(tags && tags.length)) {
        return jsonText({ error: 'provide query and/or tags' });
      }
      const hits = readyIndex()
        ? await searchJournalIndex({ query, tags, since, until, limit, mode })
        : searchJournal(loadNotes(), { query, tags, since, until, limit });
      return jsonText({ count: hits.length, hits });
    }
  );

  server.registerTool(
    'dictawhisper_get_note',
    {
      description:
        'Fetch one note by sidecar path (from search/recent) or a unique basename. Returns cleaned text and tags. Set includeRaw for the Whisper transcript.',
      inputSchema: {
        file: z.string().describe('Absolute sidecar path, or unique basename like 2026-08-15.json'),
        includeRaw: z.boolean().optional().describe('Include the raw Whisper transcript'),
      },
      annotations: readOnly,
    },
    async ({ file, includeRaw }) => {
      const resolved = readyIndex()?.findJsonFile(file) || file;
      const result = getJournalNote(loadNotes(), resolved, { includeRaw });
      if (!result.ok) return jsonText({ error: result.error });
      return jsonText(result.note);
    }
  );

  server.registerTool(
    'dictawhisper_list_tags',
    {
      description: 'List tags in the journal with counts. Singletons are hidden unless includeSingletons is true.',
      inputSchema: {
        includeSingletons: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional().describe('Max tags (default 200)'),
      },
      annotations: readOnly,
    },
    async ({ includeSingletons, limit }) => {
      const tags = readyIndex()
        ? journalTags({ includeSingletons, limit })
        : listJournalTags(loadNotes(), { includeSingletons, limit });
      return jsonText({ count: tags.length, tags });
    }
  );

  server.registerTool(
    'dictawhisper_recent',
    {
      description: 'Newest notes first. Optional tag and day range filters.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('Max notes (default 20)'),
        tags: z.array(z.string()).optional(),
        since: z.string().optional().describe('Inclusive start day YYYY-MM-DD'),
        until: z.string().optional().describe('Inclusive end day YYYY-MM-DD'),
      },
      annotations: readOnly,
    },
    async ({ limit, tags, since, until }) => {
      const hits = readyIndex()
        ? recentJournalIndex({ limit, tags, since, until })
        : recentJournal(loadNotes(), { limit, tags, since, until });
      return jsonText({ count: hits.length, hits });
    }
  );

  return server;
}

async function main() {
  if (!config.watch.roots.length && !config.watch.browserDropFolder) {
    console.error('[mcp] no watch roots in config.json');
  }
  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
