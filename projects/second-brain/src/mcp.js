// MCP tool definitions, shared by the stdio server (local apps) and the
// HTTP /mcp endpoint (remote connectors such as claude.ai).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TYPES } from './store.js';

const INSTRUCTIONS = `This is the user's Second Brain: long-term memory shared across every AI assistant they use.
- At the start of a conversation, call brain_context (optionally with a topic) to load who the user is and what they care about.
- Before answering questions about the user, their projects, people, past decisions or preferences, call brain_recall.
- When the user tells you something worth keeping (a preference, a fact about them, a decision, a project detail, a how-to that worked), call brain_remember. Keep each memory to one idea with a clear title.
- If brain_remember reports a possible duplicate, prefer brain_update on the existing memory instead of creating another.
- Never store passwords, API keys or other secrets.`;

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
const wrap = (fn) => async (args, extra) => { try { return text(await fn(args, extra)); } catch (e) { return fail(e); } };

export function createMcpServer(brain, { defaultSource } = {}) {
  const server = new McpServer({ name: 'second-brain', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const sourceOf = (s) => s || defaultSource || server.server.getClientVersion()?.name || 'mcp';

  server.registerTool('brain_remember', {
    title: 'Remember',
    description: 'Save a new memory to the Second Brain. One idea per memory. Returns the memory and any possible duplicates.',
    inputSchema: {
      content: z.string().describe('The memory itself, in Markdown. Use [[Title]] to link other memories.'),
      title: z.string().optional().describe('Short title; defaults to the first line of content'),
      type: z.enum(TYPES).optional().describe('Kind of memory (default: note)'),
      tags: z.array(z.string()).optional(),
      importance: z.number().int().min(1).max(5).optional().describe('1 trivial … 5 critical (default 3)'),
      pinned: z.boolean().optional().describe('Always include in brain_context'),
      source: z.string().optional().describe('Which assistant/app is saving this; filled in automatically if omitted'),
    },
  }, wrap((a) => brain.remember({ ...a, source: sourceOf(a.source) })));

  server.registerTool('brain_recall', {
    title: 'Recall',
    description: 'Search memories by keywords, with optional filters. Returns ranked snippets; use brain_get for the full text.',
    inputSchema: {
      query: z.string().optional().describe('Keywords; empty returns most recent'),
      type: z.enum(TYPES).optional(),
      tags: z.array(z.string()).optional().describe('All of these tags must match'),
      source: z.string().optional(),
      since: z.string().optional().describe('ISO date; only memories updated on/after it'),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, wrap((a) => brain.search(a)));

  server.registerTool('brain_get', {
    title: 'Get memory',
    description: 'Read one memory in full, including links and backlinks. Accepts an id or an exact title.',
    inputSchema: { id: z.string().describe('Memory id or exact title') },
  }, wrap(({ id }) => brain.get(id) ?? { error: `not found: ${id}` }));

  server.registerTool('brain_update', {
    title: 'Update memory',
    description: 'Change an existing memory. Use append to add to it without rewriting.',
    inputSchema: {
      id: z.string().describe('Memory id or exact title'),
      content: z.string().optional().describe('Replace the whole content'),
      append: z.string().optional().describe('Add a paragraph to the end'),
      title: z.string().optional(),
      type: z.enum(TYPES).optional(),
      tags: z.array(z.string()).optional().describe('Replace tags'),
      add_tags: z.array(z.string()).optional(),
      importance: z.number().int().min(1).max(5).optional(),
      pinned: z.boolean().optional(),
    },
  }, wrap(({ id, ...patch }) => brain.update(id, patch)));

  server.registerTool('brain_forget', {
    title: 'Forget memory',
    description: 'Remove a memory (moved to the vault .trash folder, so it can be recovered). Only when the user asks or it is clearly wrong.',
    inputSchema: { id: z.string().describe('Memory id or exact title') },
    annotations: { destructiveHint: true },
  }, wrap(({ id }) => brain.forget(id)));

  server.registerTool('brain_related', {
    title: 'Related memories',
    description: 'Memories linked to, linked from, or similar to a given memory.',
    inputSchema: { id: z.string(), limit: z.number().int().min(1).max(50).optional() },
  }, wrap(({ id, limit }) => brain.related(id, limit)));

  server.registerTool('brain_context', {
    title: 'Load context',
    description: 'Call at the start of a conversation: pinned memories and key preferences in full, recent memories, and optionally memories about a topic.',
    inputSchema: { topic: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
  }, wrap((a) => brain.context(a)));

  server.registerTool('brain_stats', {
    title: 'Brain stats',
    description: 'Counts by type, source and top tags.',
    inputSchema: {},
  }, wrap(() => brain.stats()));

  return server;
}
