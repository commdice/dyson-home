// OpenAPI 3.1 spec for the REST API. Paste /openapi.json into a ChatGPT Custom GPT
// "Actions" import (auth: API key, Bearer) or any tool that speaks OpenAPI.
import { TYPES } from './store.js';

const Memory = {
  type: 'object',
  properties: {
    id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
    type: { type: 'string', enum: TYPES }, tags: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' }, importance: { type: 'integer' }, pinned: { type: 'boolean' },
    created: { type: 'string' }, updated: { type: 'string' },
  },
};
const json = (schema) => ({ content: { 'application/json': { schema } } });
const ok = (schema = { type: 'object' }) => ({ 200: { description: 'OK', ...json(schema) } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Memory id or exact title' };

export const openapi = (url) => ({
  openapi: '3.1.0',
  info: {
    title: 'Second Brain',
    version: '1.0.0',
    description: "The user's long-term memory, shared across AI assistants. Search it before answering questions about the user; save durable facts, preferences and decisions to it. Never save secrets.",
  },
  servers: [{ url }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, schemas: { Memory } },
  security: [{ bearer: [] }],
  paths: {
    '/memories': {
      get: {
        operationId: 'recall', summary: 'Search memories (empty q = most recent)',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: TYPES } },
          { name: 'tags', in: 'query', schema: { type: 'string' }, description: 'Comma-separated; all must match' },
          { name: 'source', in: 'query', schema: { type: 'string' } },
          { name: 'since', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: ok(),
      },
      post: {
        operationId: 'remember', summary: 'Save a new memory (one idea per memory)',
        requestBody: {
          required: true,
          ...json({
            type: 'object', required: ['content'],
            properties: {
              content: { type: 'string' }, title: { type: 'string' }, type: { type: 'string', enum: TYPES },
              tags: { type: 'array', items: { type: 'string' } }, importance: { type: 'integer', minimum: 1, maximum: 5 },
              pinned: { type: 'boolean' }, source: { type: 'string', description: 'e.g. chatgpt, gemini' },
            },
          }),
        },
        responses: { 201: { description: 'Created', ...json({ type: 'object' }) } },
      },
    },
    '/memories/{id}': {
      get: { operationId: 'getMemory', summary: 'Read one memory in full', parameters: [idParam], responses: ok({ $ref: '#/components/schemas/Memory' }) },
      patch: {
        operationId: 'updateMemory', summary: 'Update a memory (use append to add text)', parameters: [idParam],
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            properties: {
              content: { type: 'string' }, append: { type: 'string' }, title: { type: 'string' },
              type: { type: 'string', enum: TYPES }, tags: { type: 'array', items: { type: 'string' } },
              add_tags: { type: 'array', items: { type: 'string' } }, importance: { type: 'integer' }, pinned: { type: 'boolean' },
            },
          }),
        },
        responses: ok({ $ref: '#/components/schemas/Memory' }),
      },
      delete: { operationId: 'forgetMemory', summary: 'Forget a memory (recoverable from .trash)', parameters: [idParam], responses: ok() },
    },
    '/memories/{id}/related': { get: { operationId: 'relatedMemories', summary: 'Linked and similar memories', parameters: [idParam], responses: ok() } },
    '/context': {
      get: {
        operationId: 'loadContext', summary: 'Call at the start of a chat: pinned memories, key preferences, recent memories',
        parameters: [{ name: 'topic', in: 'query', schema: { type: 'string' } }], responses: ok(),
      },
    },
    '/stats': { get: { operationId: 'stats', summary: 'Counts by type, source, tag', responses: ok() } },
  },
});
