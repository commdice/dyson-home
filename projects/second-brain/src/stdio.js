#!/usr/bin/env -S node --no-warnings
// MCP over stdio: for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, etc.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBrain } from './store.js';
import { createMcpServer } from './mcp.js';

const brain = openBrain();
const server = createMcpServer(brain, { defaultSource: process.env.BRAIN_SOURCE });
await server.connect(new StdioServerTransport());
console.error(`second-brain MCP (stdio) ready — vault: ${brain.vault}`);
