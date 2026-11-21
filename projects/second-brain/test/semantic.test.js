import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Brain } from '../src/store.js';
import { Semantic, recall, remember, related, stats } from '../src/semantic.js';
import { startFakeOllama } from './fake-ollama.js';

const tmpVault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sem-'));

async function setup(opts = {}) {
  const ollama = await startFakeOllama(opts);
  const brain = new Brain(tmpVault());
  brain.semantic = new Semantic(brain, { url: ollama.url, model: opts.model || 'test-embed', background: false, minSimilarity: 0.3 });
  return { ollama, brain };
}

test('finds memories by meaning when no keywords match', async () => {
  const { ollama, brain } = await setup();
  brain.remember({ content: 'The shop van is a 2019 Ford Transit, white, plate PNT-42', title: 'Shop van' });
  brain.remember({ content: 'Toner for the front desk printer is HP 58A', title: 'Printer supplies' });
  await brain.semantic.run();

  assert.equal(brain.search({ query: 'automobile' }).results.length, 0, 'keyword search alone finds nothing');
  const r = await recall(brain, { query: 'automobile' });
  assert.equal(r.semantic, 'on');
  assert.equal(r.results[0].title, 'Shop van');
  assert.equal(r.results[0].match, 'meaning');
  assert.ok(r.results[0].similarity > 0.3);
  assert.ok(!r.results.some((m) => m.title === 'Printer supplies'), 'unrelated memory is filtered by the similarity floor');
  await ollama.close();
});

test('hybrid: a memory matching by words and meaning ranks first', async () => {
  const { ollama, brain } = await setup();
  brain.remember({ content: 'Nightly backups of the POS go to the NAS', title: 'POS backups' });
  brain.remember({ content: 'Snapshots of the file share are kept 30 days', title: 'Share snapshots' });
  brain.remember({ content: 'Order more primer before spring', title: 'Primer' });
  await brain.semantic.run();
  const r = await recall(brain, { query: 'backups' });
  assert.equal(r.results[0].title, 'POS backups');
  assert.equal(r.results[0].match, 'both');
  assert.ok(r.results.some((m) => m.title === 'Share snapshots' && m.match === 'meaning'));
  await ollama.close();
});

test('filters apply to meaning matches too', async () => {
  const { ollama, brain } = await setup();
  brain.remember({ content: 'Delivery truck needs new tyres', type: 'note', tags: ['fleet'] });
  brain.remember({ content: 'Always lock the van overnight', type: 'preference' });
  await brain.semantic.run();
  const r = await recall(brain, { query: 'automobile', type: 'preference' });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].type, 'preference');
  await ollama.close();
});

test('falls back to keywords when Ollama is down', async () => {
  const { ollama, brain } = await setup();
  brain.remember({ content: 'Router admin page is at 192.168.1.1', title: 'Router' });
  await brain.semantic.run();
  ollama.up = false;
  const r = await recall(brain, { query: 'router' });
  assert.match(r.semantic, /unavailable/);
  assert.equal(r.results[0].title, 'Router');
  // Writes never fail because Ollama is down; embedding retries later.
  brain.remember({ content: 'Guest wifi password rotates monthly', title: 'Guest wifi' });
  await brain.semantic.run();
  assert.equal(brain.semantic.status().state, 'error');
  ollama.up = true;
  await brain.semantic.run();
  assert.deepEqual([brain.semantic.status().state, brain.semantic.status().embedded], ['idle', 2]);
  await ollama.close();
});

test('only new or changed memories are re-embedded; deleted ones are dropped; model change re-embeds', async () => {
  const { ollama, brain } = await setup();
  const a = brain.remember({ content: 'Invoices are paid on the 15th', title: 'Billing' }).memory;
  brain.remember({ content: 'Paint mixer service is due in March', title: 'Mixer' });
  await brain.semantic.run();
  assert.equal(ollama.embeddedTexts.length, 2);
  await brain.semantic.run();
  assert.equal(ollama.embeddedTexts.length, 2, 'nothing new → no calls');
  brain.update(a.id, { append: 'Use QuickBooks.' });
  await brain.semantic.run();
  assert.equal(ollama.embeddedTexts.length, 3, 'only the edited memory');
  brain.forget(a.id);
  await brain.semantic.run();
  assert.equal(brain.db.prepare('SELECT count(*) AS n FROM embeddings').get().n, 1);

  const other = new Semantic(brain, { url: ollama.url, model: 'another-model', background: false });
  await other.run();
  assert.equal(other.status().embedded, 1);
  assert.ok(ollama.models.has('another-model'));
  await ollama.close();
});

test('pulls the model automatically when Ollama does not have it', async () => {
  const { ollama, brain } = await setup({ hasModel: false });
  brain.remember({ content: 'Backups run nightly', title: 'Backups' });
  await brain.semantic.run(); // 404 → starts pull in the background, then embeds
  for (let i = 0; i < 100 && brain.semantic.status().embedded === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(ollama.pulls, 1);
  assert.equal(brain.semantic.status().embedded, 1);
  await brain.semantic.run();
  assert.equal(ollama.pulls, 1, 'pulled once only');
  await ollama.close();
});

test('nomic models get their search prefixes', async () => {
  const { ollama, brain } = await setup({ model: 'nomic-embed-text' });
  brain.remember({ content: 'Paint colour codes live in the tint machine', title: 'Tint codes' });
  await brain.semantic.run();
  await recall(brain, { query: 'colour' });
  assert.ok(ollama.embeddedTexts[0].startsWith('search_document: '));
  assert.ok(ollama.embeddedTexts.at(-1).startsWith('search_query: '));
  await ollama.close();
});

test('duplicates and related memories are found by meaning', async () => {
  const { ollama, brain } = await setup();
  const first = brain.remember({ content: 'Backups go to the Synology every night', title: 'Synology backups' }).memory;
  brain.remember({ content: 'Order gallon cans of primer', title: 'Primer order' });
  await brain.semantic.run();
  const dup = await remember(brain, { content: 'Nightly snapshot copies are stored on the NAS', title: 'NAS snapshot schedule' });
  assert.ok(dup.possible_duplicates.some((m) => m.id === first.id), 'different words, same meaning → flagged');
  await brain.semantic.run();
  const rel = related(brain, first.id);
  assert.ok(rel.related.some((x) => x.id === dup.memory.id && x.why === 'similar meaning'));
  assert.equal(stats(brain).semantic.embedded, 3);
  await ollama.close();
});

test('HTTP server: semantic recall end to end, embedding in the background', async () => {
  const ollama = await startFakeOllama();
  const vault = tmpVault();
  const PORT = 18000 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, ['--no-warnings', path.resolve(import.meta.dirname, '../src/http.js')], {
    env: { ...process.env, BRAIN_VAULT: vault, BRAIN_PORT: String(PORT), BRAIN_TOKEN: 't', OLLAMA_URL: ollama.url, BRAIN_EMBED_MODEL: 'test-embed', BRAIN_MIN_SIMILARITY: '0.3' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      proc.stderr.on('data', (d) => /semantic search: on/.test(d) && resolve());
      proc.on('exit', (c) => reject(new Error('server exited ' + c)));
    });
    const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { ...o, headers: { authorization: 'Bearer t', 'content-type': 'application/json' } }).then((r) => r.json());
    await api('/memories', { method: 'POST', body: JSON.stringify({ content: 'Delivery truck lease ends in June', title: 'Truck lease' }) });
    let s;
    for (let i = 0; i < 50; i++) { s = await api('/stats'); if (s.semantic.embedded === 1) break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(s.semantic.embedded, 1, 'embedded in the background after the write');
    const r = await api('/memories?q=vehicle');
    assert.equal(r.results[0].title, 'Truck lease');
    assert.equal(r.results[0].match, 'meaning');
    assert.equal((await api('/health')).semantic, 'idle');
  } finally {
    proc.kill();
    await ollama.close();
  }
});
