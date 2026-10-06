import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { apiRoutes } from '../src/apiRoutes.ts';
import { config } from '../src/config.ts';
import { JournalIndex, setJournalIndex } from '../src/lib/journalIndexLib.ts';
import { initMayDoBackfill, getMayDoBackfill } from '../src/lib/mayDoService.ts';

async function request(method: string, body: any = {}) {
  const handler = apiRoutes.find(row => row.path === '/tools/may-dos/backfill' && row.method === method)!.handler;
  let status = 200, data: any;
  await (handler as any)({ body }, { status(value: number) { status = value; return this; }, json(value: any) { data = value; } });
  return { status, data };
}

test('production routes validate intents, expose scope/model, and resume durable work without widening the scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-maydo-api-'));
  const oldRoots = config.watch.roots, oldModel = config.ollanet.cleanModel, oldMachine = config.ollanet.machine;
  const index = new JournalIndex(path.join(root, 'index.sqlite'));
  const calls: string[] = [];
  let release!: () => void, announced!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), begun = new Promise<void>(resolve => announced = resolve);
  try {
    config.watch.roots = [root]; config.ollanet.cleanModel = 'Fixture model'; config.ollanet.machine = 'http://127.0.0.1:1';
    for (const dir of ['2026', '2025', '_holding']) {
      fs.mkdirSync(path.join(root, dir));
      fs.writeFileSync(path.join(root, dir, `${dir.startsWith('_') ? '2026' : dir}-01-01_entry.json`), JSON.stringify({ text: 'I should call the dentist.' }));
    }
    index.rebuildFromRoots([root]); setJournalIndex(index);
    initMayDoBackfill(path.join(root, '.dictawhisper', 'job.json'), () => {}, async file => { calls.push(file); announced(); await gate; });
    assert.equal((await request('POST', { action: 'unknown' })).status, 400);
    assert.equal((await request('POST', { year: 'bad' })).status, 400);
    const started = await request('POST', { action: 'start', year: '2026' });
    await begun;
    assert.equal(started.status, 200); assert.equal(started.data.total, 1); assert.equal(started.data.model, 'Fixture model');
    assert.deepEqual(started.data.scope, { year: '2026', refresh: false });
    assert.equal((await request('POST', { action: 'resume', id: 'stale' })).status, 409);
    assert.equal((await request('POST', { action: 'stop', id: started.data.id })).status, 200);
    release();
    for (let i = 0; i < 50 && getMayDoBackfill().running; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const ended = await request('GET'); assert.equal(ended.data.state, 'stopped'); assert.equal(ended.data.updated, 1);
    assert.equal(calls.length, 1); assert.match(calls[0], /2026/); assert.ok(!calls[0].includes('_holding'));
    config.ollanet.cleanModel = '';
    assert.equal((await request('POST', { action: 'start' })).status, 400);
    assert.equal((await request('GET')).data.available, false);
  } finally {
    release?.(); setJournalIndex(null); index.close(); config.watch.roots = oldRoots; config.ollanet.cleanModel = oldModel; config.ollanet.machine = oldMachine;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
