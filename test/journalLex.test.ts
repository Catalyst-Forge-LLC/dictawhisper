import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('journal.search=lex indexes and searches without embedding or contacting any host', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-lex-'));
  const notes = path.join(root, 'notes');
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(
    path.join(notes, '2026-09-01_walk.json'),
    JSON.stringify({ cleanedTranscription: 'Walked to the harbor and planned the garden.', tags: [] }),
  );
  const configFile = path.join(root, 'config.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      watch: { roots: [notes], browserDropFolder: path.join(root, 'drop') },
      journal: { index: path.join(root, 'journal.sqlite'), search: 'lex', embedHost: 'any' },
    }),
  );
  process.env.DICTA_CONFIG = configFile;
  delete process.env.DICTA_EMBED_HOST;

  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetched.push(String(input instanceof Request ? input.url : input));
    throw new Error('network disabled in test');
  }) as typeof fetch;

  try {
    const service = await import('../src/lib/journalService.ts');
    const result = await service.rebuildJournalIndex([notes]);
    assert.equal(result.embedded, 0);
    assert.equal(await service.ensureEmbeddings(), 0);

    const hits = await service.searchJournalIndex({ query: 'harbor garden', mode: 'semantic' });
    assert.equal(hits.length, 1);

    const status = service.embedStatus();
    assert.equal(status?.semantic, false);
    assert.match(status?.reason || '', /journal\.search is lex/);
    assert.equal(service.journalStats().embedded, 0);
    assert.deepEqual(fetched, []);
    service.getJournalIndex()?.close();
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
