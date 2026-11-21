// End-to-end: start the HTTP server, use the REST API, then talk to /mcp with the
// official MCP client, and to the stdio server the way Claude Code would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-http-'));
const PORT = 17000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token-123';
const src = path.resolve(import.meta.dirname, '../src');
let proc;

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', path.join(src, 'http.js')], {
    env: { ...process.env, BRAIN_VAULT: vault, BRAIN_PORT: String(PORT), BRAIN_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    proc.stderr.on('data', (d) => /HTTP on/.test(d) && resolve());
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
});
after(() => proc?.kill());

const api = (p, opts = {}) =>
  fetch(BASE + p, { ...opts, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...opts.headers } });

test('REST: auth, create, search, patch, delete', async () => {
  assert.equal((await fetch(BASE + '/memories')).status, 401);
  assert.equal((await fetch(BASE + '/openapi.json')).status, 200);

  const r = await api('/memories', { method: 'POST', headers: { 'x-brain-source': 'chatgpt' }, body: JSON.stringify({ content: 'Favourite paint brand is Benjamin Moore', type: 'preference', tags: ['paint'] }) });
  assert.equal(r.status, 201);
  const { memory } = await r.json();
  assert.equal(memory.source, 'chatgpt');

  const s = await (await api('/memories?q=benjamin&tags=paint')).json();
  assert.equal(s.results[0].id, memory.id);

  const p = await (await api(`/memories/${memory.id}`, { method: 'PATCH', body: JSON.stringify({ append: 'Aura line especially.' }) })).json();
  assert.match(p.content, /Aura/);

  assert.equal((await api('/memories/nope')).status, 404);
  assert.equal((await api(`/memories/${memory.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/memories/${memory.id}`)).status, 404);
});

test('MCP over HTTP: list tools, remember, recall', async () => {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp?source=claude-ai'), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  const { tools } = await client.listTools();
  assert.ok(['brain_remember', 'brain_recall', 'brain_context', 'brain_get', 'brain_update', 'brain_forget'].every((n) => tools.some((t) => t.name === n)));
  const saved = JSON.parse((await client.callTool({ name: 'brain_remember', arguments: { content: 'Shop network uses a Ubiquiti gateway', tags: ['network'] } })).content[0].text);
  assert.equal(saved.memory.source, 'claude-ai'); // platform name from ?source=
  const found = JSON.parse((await client.callTool({ name: 'brain_recall', arguments: { query: 'ubiquiti' } })).content[0].text);
  assert.equal(found.results[0].id, saved.memory.id);
  await client.close();
});

test('MCP over stdio sees memories written over HTTP (shared vault)', async () => {
  const client = new Client({ name: 'claude-code', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--no-warnings', path.join(src, 'stdio.js')], env: { ...process.env, BRAIN_VAULT: vault }, stderr: 'ignore' }));
  const found = JSON.parse((await client.callTool({ name: 'brain_recall', arguments: { query: 'gateway' } })).content[0].text);
  assert.equal(found.results.length, 1);
  const bad = await client.callTool({ name: 'brain_update', arguments: { id: 'does-not-exist', append: 'x' } });
  assert.equal(bad.isError, true);
  await client.close();
});
