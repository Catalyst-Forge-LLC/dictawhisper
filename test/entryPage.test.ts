import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { JournalIndex, EntryCursorError, setJournalIndex, type EntryPageOptions } from '../src/lib/journalIndexLib.ts';

function fixture(count = 137) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-page-'));
  let time = 0;
  const index = new JournalIndex(path.join(root, 'journal.sqlite'), { now: () => time });
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const dir = path.join(root, i % 2 ? '2026/08' : '2026/09'); fs.mkdirSync(dir, { recursive: true });
    const day = `2026-${i % 2 ? '08' : '09'}-${String(i % 28 + 1).padStart(2, '0')}`;
    const file = path.join(dir, `${day}_item-${String(i).padStart(4, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify({ cleanedTranscription: 'shared journal repair plans',
      tags: i % 3 === 0 ? ['home', 'budget'] : ['home'], starred: i % 2 === 0,
      mayDos: [{ id: `action-${i}`, title: 'Repair the kitchen', sourceQuote: 'repair plans', status: i % 2 ? 'selected' : 'suggested' }] }));
    files.push(file);
  }
  index.rebuildFromRoots([root]);
  return { root, index, files, expire: () => { time += 60_001; }, close: () => { index.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
function all(index: JournalIndex, options: EntryPageOptions) {
  let page = index.searchPage(options); const hits = [...page.items]; const total = page.total;
  while (page.hasMore) { page = index.searchPage({ ...options, cursor: page.nextCursor! }); assert.equal(page.total, total); hits.push(...page.items); }
  assert.equal(page.nextCursor, null); return { hits, total };
}
test('filter-only and lexical pages expose accurate totals, globally sorted stable entries beyond 50', () => {
  const f = fixture();
  try {
    for (const query of ['', 'shared', 'filename:item']) {
      const recent = all(f.index, { query, folder: 'active', mode: 'lex', sort: 'recent' });
      const oldest = all(f.index, { query, folder: 'active', mode: 'lex', sort: 'oldest' });
      assert.equal(recent.total, 137); assert.equal(recent.hits.length, 137);
      assert.equal(new Set(recent.hits.map(hit => hit.jsonFile)).size, 137);
      assert.deepEqual(oldest.hits.map(hit => hit.jsonFile), recent.hits.map(hit => hit.jsonFile).reverse());
      assert.deepEqual(recent.hits.map(hit => hit.jsonFile), f.index.list({ all: true, folder: 'active' }).map(hit => hit.jsonFile));
    }
    assert.equal(f.index.search({ query: 'shared', sort: 'oldest', limit: 50 }).length, 50);
    assert.deepEqual(f.index.search({ query: 'shared', sort: 'oldest', limit: 50 }), f.index.searchPage({ query: 'shared', sort: 'oldest' }).items);
    assert.equal(f.index.search({}).length, 0); // preserve legacy blank search
  } finally { f.close(); }
});
test('cursor authentication, scope mismatch, normalization and index changes are explicit', () => {
  const f = fixture();
  try {
    const first = f.index.searchPage({ query: 'shared', tags: ['home'], sort: 'recent' });
    assert.equal(first.items.length, 50); assert.equal(first.countKind, 'exact');
    const invalid = (options: EntryPageOptions) => assert.throws(() => f.index.searchPage(options), error => error instanceof EntryCursorError && error.code === 'invalid_cursor');
    invalid({ query: 'shared', cursor: 'bad' });
    invalid({ query: 'shared', tags: ['home'], sort: 'oldest', cursor: first.nextCursor! });
    invalid({ query: 'other', tags: ['home'], sort: 'recent', cursor: first.nextCursor! });
    assert.equal(f.index.searchPage({ query: 'shared', tags: ['HOME', 'home'], sort: 'recent', cursor: first.nextCursor! }).items.length, 50);
    const file = f.files[0]; const note = JSON.parse(fs.readFileSync(file, 'utf8')); note.displayTitle = 'Renamed'; fs.writeFileSync(file, JSON.stringify(note)); f.index.upsertSidecar(file);
    assert.throws(() => f.index.searchPage({ query: 'shared', tags: ['home'], sort: 'recent', cursor: first.nextCursor! }), error => error instanceof EntryCursorError && error.code === 'cursor_expired');
  } finally { f.close(); }
});
test('date precedence, AND tags, OR MayDo statuses, stars apply consistently to every query path', () => {
  const f = fixture();
  try {
    f.index.ensureVec(2, 'fixture'); for (const row of f.index.rowsNeedingEmbed()) f.index.putEmbedding(row.rowid, [1, 0]);
    const scope: EntryPageOptions = { folder: 'active', since: '2026-09-01', until: '2026-09-30', year: '2010',
      tags: ['home', 'budget'], mayDos: ['suggested', 'selected'], starred: true, sort: 'recent' };
    const plain = all(f.index, scope);
    assert.equal(plain.total, 23);
    for (const mode of ['lex', 'hybrid', 'semantic'] as const) {
      const result = all(f.index, { ...scope, query: 'shared', mode, queryEmbedding: [1, 0] });
      assert.equal(result.total, 23); assert.deepEqual(result.hits.map(hit => hit.jsonFile), plain.hits.map(hit => hit.jsonFile));
    }
    assert.equal(f.index.searchPage({ ...scope, tags: ['home', 'missing'] }).total, 0);
    assert.equal(f.index.searchPage({ ...scope, mayDos: ['done'] }).total, 0);
  } finally { f.close(); }
});
test('ranked snapshots cap candidates, survive index edits, reject different scopes, and expire after 60 seconds', () => {
  const f = fixture(507);
  try {
    f.index.ensureVec(2, 'fixture'); for (const row of f.index.rowsNeedingEmbed()) f.index.putEmbedding(row.rowid, [1, 0]);
    const options: EntryPageOptions = { query: 'shared', mode: 'hybrid', folder: 'active', queryEmbedding: [1, 0] };
    const first = f.index.searchPage(options); assert.equal(first.countKind, 'ranked'); assert.equal(first.total, 500); assert.equal(first.candidateLimit, 500);
    const file = f.files[0]; const note = JSON.parse(fs.readFileSync(file, 'utf8')); note.displayTitle = 'Changed after snapshot'; fs.writeFileSync(file, JSON.stringify(note)); f.index.upsertSidecar(file);
    let page = first; const hits = [...first.items];
    while (page.hasMore) { page = f.index.searchPage({ ...options, queryEmbedding: null, cursor: page.nextCursor! }); hits.push(...page.items); }
    assert.equal(hits.length, 500); assert.equal(new Set(hits.map(hit => hit.jsonFile)).size, 500);
    assert.ok(hits.every(hit => hit.displayTitle !== 'Changed after snapshot'));
    f.expire();
    assert.throws(() => f.index.searchPage({ ...options, queryEmbedding: null, cursor: first.nextCursor! }), error => error instanceof EntryCursorError && error.code === 'cursor_expired');
    assert.equal(f.index.searchPage({ ...options, mode: 'lex' }).total, 507);
    assert.equal(f.index.searchPage({ ...options, queryEmbedding: null }).countKind, 'exact');
  } finally { f.close(); }
});

test('HTTP page opt-in and legacy service preserve their response contracts and cursor status codes', async () => {
  const f = fixture();
  setJournalIndex(f.index);
  try {
    const { apiRoutes } = await import('../src/apiRoutes.ts');
    const { searchJournalIndex } = await import('../src/lib/journalService.ts');
    const handler = apiRoutes.find(route => route.path === '/notes/search')!.handler;
    async function request(query: Record<string, unknown>) {
      let status = 200; let data: any;
      const response = { status(value: number) { status = value; return this; }, json(value: unknown) { data = value; } };
      await (handler as any)({ query }, response);
      return { status, data };
    }
    const legacy = await request({ q: 'shared', mode: 'lex', limit: '50' });
    assert.deepEqual(Object.keys(legacy.data).sort(), ['count', 'hits']); assert.equal(legacy.data.count, 50);
    assert.ok(Array.isArray(await searchJournalIndex({ query: 'shared', mode: 'lex' })));
    const first = await request({ q: 'shared', mode: 'lex', page: '1' });
    assert.equal(first.status, 200); assert.equal(first.data.total, 137); assert.equal(first.data.items.length, 50); assert.equal(first.data.countKind, 'exact');
    const second = await request({ q: 'shared', mode: 'lex', page: '1', cursor: first.data.nextCursor });
    assert.equal(second.status, 200); assert.equal(second.data.items.length, 50);
    assert.equal((await request({ q: 'shared', mode: 'lex', page: '1', cursor: 'broken' })).status, 400);
    assert.equal((await request({ q: 'shared', mode: 'lex', page: '1', mayDoStatus: 'invalid' })).status, 400);
    const file = f.files[0]; const note = JSON.parse(fs.readFileSync(file, 'utf8')); note.displayTitle = 'HTTP test edit'; fs.writeFileSync(file, JSON.stringify(note)); f.index.upsertSidecar(file);
    const expired = await request({ q: 'shared', mode: 'lex', page: '1', cursor: first.data.nextCursor });
    assert.equal(expired.status, 409); assert.equal(expired.data.code, 'cursor_expired');
  } finally { setJournalIndex(null); f.close(); }
});

test('current MCP clients can still search, get, list tags and read recent entries', async () => {
  const f = fixture();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const configFile = path.join(f.root, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ watch: { roots: [f.root], browserDropFolder: f.root }, journal: { index: f.index.dbPath, search: 'lex' } }));
  const client = new Client({ name: 'ux04-compatibility-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', path.resolve('src/mcp.ts')], env: { DICTA_CONFIG: configFile }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['dictawhisper_get_note', 'dictawhisper_list_tags', 'dictawhisper_recent', 'dictawhisper_search']);
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args }) as { content: { text: string }[] };
      return JSON.parse(result.content[0].text);
    }
    const search = await call('dictawhisper_search', { query: 'shared', mode: 'lex', limit: 50 });
    assert.equal(search.count, 50); assert.equal(search.hits.length, 50); assert.equal(search.items, undefined);
    const note = await call('dictawhisper_get_note', { file: search.hits[0].jsonFile });
    assert.equal(note.text, 'shared journal repair plans');
    const recent = await call('dictawhisper_recent', { limit: 2 }); assert.equal(recent.count, 2);
    const tags = await call('dictawhisper_list_tags', {}); assert.ok(JSON.stringify(tags).includes('home'));
  } finally { await client.close(); await transport.close(); f.close(); }
});
