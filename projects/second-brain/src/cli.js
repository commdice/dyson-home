#!/usr/bin/env -S node --no-warnings
// brain — command-line access to the Second Brain (also handy from shell scripts and cron).
import { parseArgs } from 'node:util';
import { openBrain, TYPES } from './store.js';

const HELP = `brain <command> [options]

  add <text…>            save a memory   [-t title] [--type ${TYPES.join('|')}] [--tags a,b] [-i 1-5] [--pin]
  search <query…>        search          [--type T] [--tags a,b] [-n limit]
  get <id|title>         show one memory in full
  edit <id> …            update          [--append text] [--content text] [-t title] [--tags a,b] [-i N] [--pin|--unpin]
  forget <id|title>      move to .trash
  related <id|title>     linked and similar memories
  context [topic…]       what an assistant loads at session start
  recent [-n N]          latest memories
  stats                  counts by type, source and tag
  reindex                rebuild the search index from the files
  serve                  start the HTTP server (REST + remote MCP)
  mcp                    start the stdio MCP server

Vault: $BRAIN_VAULT (default ~/SecondBrain).  Add --json for machine-readable output.`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string', short: 't' }, type: { type: 'string' }, tags: { type: 'string' },
    importance: { type: 'string', short: 'i' }, pin: { type: 'boolean' }, unpin: { type: 'boolean' },
    append: { type: 'string' }, content: { type: 'string' }, limit: { type: 'string', short: 'n' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
const [cmd, ...rest] = positionals;
const arg = rest.join(' ');

if (!cmd || o.help) { console.log(HELP); process.exit(0); }
if (cmd === 'serve') { await import('./http.js'); }
else if (cmd === 'mcp') { await import('./stdio.js'); }
else {
  const brain = openBrain();
  const tags = o.tags?.split(',');
  const show = (x) => {
    if (o.json) return console.log(JSON.stringify(x, null, 2));
    const line = (m) => `${m.pinned ? '📌 ' : ''}[${m.id}] ${m.title}  (${m.type}${m.tags?.length ? ' #' + m.tags.join(' #') : ''})`;
    if (x?.results) return x.results.length ? x.results.forEach((m) => console.log(line(m) + '\n    ' + m.snippet.replace(/\n/g, ' '))) : console.log('No matches.');
    if (x?.memory && x.possible_duplicates) {
      console.log('Saved ' + line(x.memory));
      if (x.possible_duplicates.length) console.log('Similar existing:\n' + x.possible_duplicates.map((m) => '  ' + line(m)).join('\n'));
      return;
    }
    if (x?.content !== undefined) {
      console.log(line(x) + `\nsource: ${x.source}  importance: ${x.importance}  updated: ${x.updated}\n\n${x.content}`);
      if (x.backlinks?.length) console.log('\nBacklinks: ' + x.backlinks.map((b) => b.title).join(', '));
      return;
    }
    console.log(JSON.stringify(x, null, 2));
  };
  try {
    switch (cmd) {
      case 'add': {
        if (!arg) throw new Error('nothing to add');
        show(brain.remember({ content: arg, title: o.title, type: o.type, tags, importance: o.importance, pinned: o.pin, source: process.env.BRAIN_SOURCE || 'cli' }));
        break;
      }
      case 'search': show(brain.search({ query: arg, type: o.type, tags, limit: o.limit })); break;
      case 'recent': show(brain.search({ limit: o.limit || 10 })); break;
      case 'get': { const m = brain.get(arg); if (!m) throw new Error(`not found: ${arg}`); show(m); break; }
      case 'edit': {
        const patch = { append: o.append, content: o.content, title: o.title, type: o.type, tags, importance: o.importance };
        if (o.pin) patch.pinned = true;
        if (o.unpin) patch.pinned = false;
        Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
        show(brain.update(rest[0], patch));
        break;
      }
      case 'forget': show(brain.forget(arg)); break;
      case 'related': show(brain.related(arg)); break;
      case 'context': show(brain.context({ topic: arg || undefined })); break;
      case 'stats': show(brain.stats()); break;
      case 'reindex': show(brain.reindex()); break;
      default: console.log(HELP); process.exit(1);
    }
  } catch (e) {
    console.error('Error: ' + e.message);
    process.exit(1);
  }
}
