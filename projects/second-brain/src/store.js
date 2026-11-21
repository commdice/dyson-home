// Second Brain store.
//
// Source of truth: one Markdown file per memory, with front matter, in a vault
// folder (Obsidian-compatible, git-friendly, readable without this software).
// Search index: SQLite FTS5 in <vault>/.brain/index.db. It can be deleted at
// any time and is rebuilt from the files. Files edited by hand (or by another
// process) are picked up on the next read.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TYPES = ['fact', 'preference', 'person', 'project', 'decision', 'howto', 'note', 'journal'];

const FIELDS = ['id', 'title', 'type', 'tags', 'source', 'importance', 'pinned', 'links', 'created', 'updated'];
const SYNC_INTERVAL_MS = 2000;

// ---------- front matter (every value is JSON, which is also valid YAML) ----------

export function serialize(mem) {
  const lines = ['---'];
  for (const k of FIELDS) if (mem[k] !== undefined) lines.push(`${k}: ${JSON.stringify(mem[k])}`);
  lines.push('---', '', mem.content.trim(), '');
  return lines.join('\n');
}

export function parse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim();
    try { meta[kv[1]] = JSON.parse(raw); } catch { meta[kv[1]] = raw.replace(/^['"]|['"]$/g, ''); }
  }
  return { ...meta, content: m[2].trim() };
}

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 60) || 'memory';

const now = () => new Date().toISOString();
const newId = () => crypto.randomBytes(5).toString('hex');

function normTags(tags) {
  if (!tags) return [];
  const arr = Array.isArray(tags) ? tags : String(tags).split(',');
  return [...new Set(arr.map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];
}

function wikiLinks(content) {
  return [...content.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim());
}

// Turn free text into a safe FTS5 query: quoted prefix terms.
function ftsQuery(q, mode = 'AND') {
  const terms = (q.match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 24);
  if (!terms.length) return null;
  return terms.map((t) => `"${t}"*`).join(` ${mode} `);
}

// ---------- store ----------

export class Brain {
  constructor(vault) {
    this.vault = path.resolve(vault);
    fs.mkdirSync(path.join(this.vault, '.brain'), { recursive: true });
    this.db = new DatabaseSync(path.join(this.vault, '.brain', 'index.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, path TEXT UNIQUE, title TEXT, content TEXT, type TEXT,
        tags TEXT, source TEXT, importance INTEGER, pinned INTEGER, links TEXT,
        created TEXT, updated TEXT, mtime REAL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED, title, content, tags, tokenize = 'porter unicode61'
      );
    `);
    this.lastSync = 0;
    this.onChange = null; // set by the semantic layer to hear about new or changed memories
    this.sync(true);
  }

  // ----- index maintenance -----

  *walk(dir = this.vault) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) yield* this.walk(p);
      else if (e.name.endsWith('.md')) yield p;
    }
  }

  sync(force = false) {
    if (!force && Date.now() - this.lastSync < SYNC_INTERVAL_MS) return;
    this.lastSync = Date.now();
    const known = new Map(this.db.prepare('SELECT path, mtime FROM memories').all().map((r) => [r.path, r.mtime]));
    const seen = new Set();
    let changed = false;
    this.db.exec('BEGIN');
    try {
      for (const file of this.walk()) {
        const rel = path.relative(this.vault, file);
        seen.add(rel);
        const mtime = fs.statSync(file).mtimeMs;
        if (known.get(rel) === mtime) continue;
        const mem = parse(fs.readFileSync(file, 'utf8'));
        if (!mem || !mem.id) continue; // not a brain memory (e.g. a hand-written note without front matter)
        this.indexRow({ ...mem, path: rel }, mtime);
        changed = true;
      }
      for (const rel of known.keys()) if (!seen.has(rel)) { this.unindexPath(rel); changed = true; }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    if (changed) this.onChange?.();
  }

  indexRow(m, mtime) {
    const tags = normTags(m.tags);
    const links = [...new Set([...(m.links || []), ...wikiLinks(m.content || '')])];
    // Drop any stale row for this id or path before inserting.
    for (const r of this.db.prepare('SELECT id FROM memories WHERE id = ? OR path = ?').all(m.id, m.path)) {
      this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(r.id);
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(r.id);
    }
    this.db
      .prepare(`INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(m.id, m.path, m.title || '', m.content || '', m.type || 'note', JSON.stringify(tags), m.source || '',
        Number(m.importance) || 3, m.pinned ? 1 : 0, JSON.stringify(links), m.created || now(), m.updated || now(), mtime);
    this.db.prepare('INSERT INTO memories_fts (id, title, content, tags) VALUES (?,?,?,?)')
      .run(m.id, m.title || '', m.content || '', tags.join(' '));
  }

  unindexPath(rel) {
    const r = this.db.prepare('SELECT id FROM memories WHERE path = ?').get(rel);
    if (!r) return;
    this.db.prepare('DELETE FROM memories_fts WHERE id = ?').run(r.id);
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(r.id);
  }

  reindex() {
    this.db.exec('DELETE FROM memories; DELETE FROM memories_fts;');
    this.sync(true);
    return this.stats();
  }

  // ----- row helpers -----

  row(r, { full = true } = {}) {
    if (!r) return null;
    const out = {
      id: r.id, title: r.title, type: r.type, tags: JSON.parse(r.tags), source: r.source,
      importance: r.importance, pinned: !!r.pinned, created: r.created, updated: r.updated, path: r.path,
    };
    if (full) { out.content = r.content; out.links = JSON.parse(r.links); }
    else out.snippet = r.snippet ?? (r.content.length > 240 ? r.content.slice(0, 240) + '…' : r.content);
    return out;
  }

  resolve(idOrTitle) {
    this.sync();
    return (
      this.db.prepare('SELECT * FROM memories WHERE id = ?').get(idOrTitle) ||
      this.db.prepare('SELECT * FROM memories WHERE lower(title) = lower(?) ORDER BY updated DESC').get(idOrTitle)
    );
  }

  writeFile(mem, oldRel) {
    const dir = path.join(this.vault, mem.type);
    fs.mkdirSync(dir, { recursive: true });
    const rel = path.relative(this.vault, path.join(dir, `${slugify(mem.title)}-${mem.id}.md`));
    const abs = path.join(this.vault, rel);
    const tmp = abs + '.tmp';
    fs.writeFileSync(tmp, serialize(mem));
    fs.renameSync(tmp, abs); // atomic replace
    if (oldRel && oldRel !== rel) fs.rmSync(path.join(this.vault, oldRel), { force: true });
    this.indexRow({ ...mem, path: rel }, fs.statSync(abs).mtimeMs);
    this.onChange?.();
    return rel;
  }

  // ----- public API -----

  remember({ content, title, type = 'note', tags, source = 'unknown', importance = 3, pinned = false, links }) {
    if (!content || !String(content).trim()) throw new Error('content is required');
    if (!TYPES.includes(type)) throw new Error(`type must be one of: ${TYPES.join(', ')}`);
    content = String(content).trim();
    title = (title || content.split('\n')[0]).replace(/^#+\s*/, '').slice(0, 100).trim();
    const similar = this.search({ query: title, limit: 3 }).results;
    const mem = {
      id: newId(), title, type, tags: normTags(tags), source,
      importance: Math.min(5, Math.max(1, Number(importance) || 3)), pinned: !!pinned,
      links: links || [], created: now(), updated: now(), content,
    };
    this.writeFile(mem);
    return { memory: this.get(mem.id), possible_duplicates: similar };
  }

  get(idOrTitle) {
    const r = this.resolve(idOrTitle);
    if (!r) return null;
    const mem = this.row(r);
    mem.backlinks = this.db
      .prepare(`SELECT m.id, m.title FROM memories m, json_each(m.links) l WHERE l.value IN (?, ?) AND m.id != ?`)
      .all(r.id, r.title, r.id).map((x) => ({ id: x.id, title: x.title }));
    return mem;
  }

  update(idOrTitle, patch = {}) {
    const r = this.resolve(idOrTitle);
    if (!r) throw new Error(`memory not found: ${idOrTitle}`);
    const cur = this.row(r);
    if (patch.type && !TYPES.includes(patch.type)) throw new Error(`type must be one of: ${TYPES.join(', ')}`);
    let content = cur.content;
    if (patch.content !== undefined) content = String(patch.content).trim();
    if (patch.append) content = `${content}\n\n${String(patch.append).trim()}`;
    let tags = patch.tags !== undefined ? normTags(patch.tags) : cur.tags;
    if (patch.add_tags) tags = normTags([...tags, ...normTags(patch.add_tags)]);
    const mem = {
      id: cur.id,
      title: patch.title ?? cur.title,
      type: patch.type ?? cur.type,
      tags,
      source: patch.source ?? cur.source,
      importance: patch.importance !== undefined ? Math.min(5, Math.max(1, Number(patch.importance))) : cur.importance,
      pinned: patch.pinned !== undefined ? !!patch.pinned : cur.pinned,
      links: patch.links ?? cur.links,
      created: cur.created,
      updated: now(),
      content,
    };
    this.writeFile(mem, cur.path);
    return this.get(mem.id);
  }

  forget(idOrTitle) {
    const r = this.resolve(idOrTitle);
    if (!r) throw new Error(`memory not found: ${idOrTitle}`);
    // Soft delete: move to .trash so nothing is ever lost by an over-eager agent.
    const trash = path.join(this.vault, '.trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(path.join(this.vault, r.path), path.join(trash, path.basename(r.path)));
    this.unindexPath(r.path);
    return { forgotten: r.id, title: r.title, recoverable_at: path.join('.trash', path.basename(r.path)) };
  }

  // SQL fragment (against alias m) for the optional search filters.
  filterSql({ type, tags, source, since } = {}) {
    const where = [];
    const args = [];
    if (type) { where.push('m.type = ?'); args.push(type); }
    if (source) { where.push('m.source = ?'); args.push(source); }
    if (since) { where.push('m.updated >= ?'); args.push(since); }
    for (const t of normTags(tags)) { where.push('EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value = ?)'); args.push(t); }
    return { filter: where.length ? ' AND ' + where.join(' AND ') : '', args };
  }

  search({ query = '', type, tags, source, since, limit = 10 } = {}) {
    this.sync();
    limit = Math.min(100, Math.max(1, Number(limit) || 10));
    const { filter, args } = this.filterSql({ type, tags, source, since });

    if (!query.trim()) {
      const rows = this.db.prepare(`SELECT m.* FROM memories m WHERE 1=1${filter} ORDER BY m.updated DESC LIMIT ?`).all(...args, limit);
      return { results: rows.map((r) => this.row(r, { full: false })) };
    }

    // Try all terms (AND) first; if nothing matches, fall back to any term (OR).
    for (const mode of ['AND', 'OR']) {
      const fq = ftsQuery(query, mode);
      if (!fq) break;
      // Score: BM25 relevance (lower is better), nudged by importance, pinning and recency.
      const rows = this.db.prepare(`
        SELECT m.*, snippet(memories_fts, 2, '**', '**', '…', 24) AS snippet,
          bm25(memories_fts, 5.0, 1.0, 3.0)
            - (m.importance - 3) * 0.3 - m.pinned * 0.5
            - 0.5 / (1 + (julianday('now') - julianday(m.updated)) / 30.0) AS score
        FROM memories_fts JOIN memories m ON m.id = memories_fts.id
        WHERE memories_fts MATCH ?${filter}
        ORDER BY score LIMIT ?`).all(fq, ...args, limit);
      if (rows.length) return { results: rows.map((r) => this.row(r, { full: false })), matched: mode === 'AND' ? 'all terms' : 'any term' };
    }
    return { results: [] };
  }

  related(idOrTitle, limit = 8) {
    const r = this.resolve(idOrTitle);
    if (!r) throw new Error(`memory not found: ${idOrTitle}`);
    const mem = this.get(r.id);
    const linked = mem.links
      .map((l) => this.resolve(l)).filter(Boolean).map((x) => ({ id: x.id, title: x.title, why: 'links to' }));
    const back = mem.backlinks.map((b) => ({ ...b, why: 'linked from' }));
    const seen = new Set([r.id, ...linked.map((x) => x.id), ...back.map((x) => x.id)]);
    const similar = this.search({ query: `${r.title} ${JSON.parse(r.tags).join(' ')}`, limit: limit + 1 }).results
      .filter((x) => !seen.has(x.id)).slice(0, limit).map((x) => ({ id: x.id, title: x.title, why: 'similar' }));
    return { memory: { id: r.id, title: r.title }, related: [...linked, ...back, ...similar] };
  }

  // What an assistant should load at the start of a session.
  context({ topic, limit = 15 } = {}) {
    this.sync();
    const pinned = this.db.prepare(
      `SELECT * FROM memories WHERE pinned = 1 OR (type = 'preference' AND importance >= 4) ORDER BY importance DESC, updated DESC LIMIT 25`,
    ).all().map((r) => this.row(r));
    const recent = this.db.prepare('SELECT * FROM memories ORDER BY updated DESC LIMIT ?').all(limit)
      .map((r) => this.row(r, { full: false })).filter((m) => !pinned.some((p) => p.id === m.id));
    const out = { pinned, recent };
    if (topic) out.topic = this.search({ query: topic, limit }).results;
    return out;
  }

  stats() {
    this.sync();
    const total = this.db.prepare('SELECT count(*) AS n FROM memories').get().n;
    const byType = Object.fromEntries(this.db.prepare('SELECT type, count(*) AS n FROM memories GROUP BY type').all().map((r) => [r.type, r.n]));
    const bySource = Object.fromEntries(this.db.prepare('SELECT source, count(*) AS n FROM memories GROUP BY source').all().map((r) => [r.source, r.n]));
    const tags = this.db.prepare(`SELECT value AS tag, count(*) AS n FROM memories, json_each(memories.tags) GROUP BY value ORDER BY n DESC LIMIT 30`).all();
    return { vault: this.vault, total, byType, bySource, topTags: tags };
  }
}

export async function openBrain({ background = true } = {}) {
  const vault = process.env.BRAIN_VAULT || path.join(process.env.HOME || process.cwd(), 'SecondBrain');
  const brain = new Brain(vault);
  if (process.env.OLLAMA_URL) {
    const { Semantic } = await import('./semantic.js');
    brain.semantic = new Semantic(brain, {
      url: process.env.OLLAMA_URL,
      model: process.env.BRAIN_EMBED_MODEL,
      minSimilarity: process.env.BRAIN_MIN_SIMILARITY,
      background,
    });
  }
  return brain;
}
