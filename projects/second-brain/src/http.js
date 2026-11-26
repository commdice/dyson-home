#!/usr/bin/env -S node --no-warnings
// HTTP server:
//   /mcp            MCP over Streamable HTTP (claude.ai custom connectors, any remote MCP client)
//   /memories ...   REST API (ChatGPT Custom GPT Actions, Gemini, n8n/Zapier, scripts, phone shortcuts)
//   /openapi.json   OpenAPI 3.1 spec for the REST API
import http from 'node:http';
import crypto from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { openBrain } from './store.js';
import { createMcpServer } from './mcp.js';
import { openapi } from './openapi.js';
import { recall, remember, related, stats, context } from './semantic.js';

const HOST = process.env.BRAIN_HOST || '127.0.0.1';
const PORT = Number(process.env.BRAIN_PORT || 7777);
const TOKEN = process.env.BRAIN_TOKEN || '';
const PUBLIC_URL = process.env.BRAIN_PUBLIC_URL || `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
const LOCAL = ['127.0.0.1', 'localhost', '::1'].includes(HOST);

if (!TOKEN && !LOCAL) {
  console.error('Refusing to listen on a non-local address without BRAIN_TOKEN. Set BRAIN_TOKEN to a long random string.');
  process.exit(1);
}

const brain = await openBrain();

function authorized(req, url) {
  if (!TOKEN) return true;
  const h = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.headers['x-api-key'] || url.searchParams.get('key') || '';
  const a = Buffer.from(String(h));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-api-key, x-brain-source, mcp-session-id, mcp-protocol-version',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(body === undefined ? '' : JSON.stringify(body, null, 2));
}

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 2_000_000) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const q = Object.fromEntries(url.searchParams);

  if (req.method === 'OPTIONS') return send(res, 204);
  if (p === '/health') return send(res, 200, { ok: true, semantic: brain.semantic ? brain.semantic.state : 'off' });
  if (p === '/openapi.json') return send(res, 200, openapi(PUBLIC_URL));
  if (!authorized(req, url)) return send(res, 401, { error: 'unauthorized' });

  // ---- MCP (stateless: a fresh server per request, all sharing one Brain) ----
  if (p === '/mcp') {
    if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
    const body = await readJson(req);
    const server = createMcpServer(brain, { defaultSource: req.headers['x-brain-source'] || q.source || 'remote-mcp' });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    return transport.handleRequest(req, res, body);
  }

  // ---- REST ----
  const source = req.headers['x-brain-source'];
  const m = p.match(/^\/memories\/([^/]+)(\/related)?$/);

  if (p === '/memories' && req.method === 'GET')
    return send(res, 200, await recall(brain, { query: q.q || '', type: q.type, tags: list(q.tags), source: q.source, since: q.since, limit: q.limit }));
  if (p === '/memories' && req.method === 'POST') {
    const b = await readJson(req);
    return send(res, 201, await remember(brain, { ...b, source: b.source || source || 'api' }));
  }
  if (m && m[2] && req.method === 'GET') return send(res, 200, related(brain, decodeURIComponent(m[1]), q.limit));
  if (m && req.method === 'GET') {
    const mem = brain.get(decodeURIComponent(m[1]));
    return mem ? send(res, 200, mem) : send(res, 404, { error: 'not found' });
  }
  if (m && req.method === 'PATCH') return send(res, 200, brain.update(decodeURIComponent(m[1]), await readJson(req)));
  if (m && req.method === 'DELETE') return send(res, 200, brain.forget(decodeURIComponent(m[1])));
  if (p === '/context' && req.method === 'GET') return send(res, 200, await context(brain, { topic: q.topic, limit: q.limit }));
  if (p === '/stats' && req.method === 'GET') return send(res, 200, stats(brain));
  if (p === '/reindex' && req.method === 'POST') {
    const out = brain.reindex();
    if (brain.semantic) brain.semantic.run();
    return send(res, 200, out);
  }

  return send(res, 404, { error: 'no such route', see: '/openapi.json' });
}

http
  .createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      const status = e.status || (/not found/.test(e.message) ? 404 : 400);
      if (!res.headersSent) send(res, status, { error: e.message });
      else res.end();
    }
  })
  .listen(PORT, HOST, () => {
    console.error(`second-brain HTTP on ${PUBLIC_URL}  (MCP: /mcp, REST: /memories, spec: /openapi.json)  vault: ${brain.vault}`);
    console.error(brain.semantic ? `semantic search: on, ${brain.semantic.model} via ${brain.semantic.url}` : 'semantic search: off (set OLLAMA_URL to enable)');
    if (!TOKEN) console.error('No BRAIN_TOKEN set: open to anything on this machine. Set one before exposing it.');
  });
