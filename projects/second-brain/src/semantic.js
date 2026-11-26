// Semantic (meaning-based) search using an Ollama embedding model.
//
// - Each memory is turned into a vector by Ollama and stored in the index DB
//   (table `embeddings`), keyed by a hash of the text, so only new or changed
//   memories are re-embedded, and switching models re-embeds everything.
// - Embedding runs in the background; a write never waits for Ollama.
// - recall() fuses keyword (FTS5) and vector results with Reciprocal Rank
//   Fusion. If Ollama is down or slow, it quietly falls back to keywords.
// - If the model isn't installed in Ollama yet, it is pulled automatically.

import crypto from 'node:crypto';

const BATCH = 16;
const RRF_K = 60;
const CANDIDATES = 50;
const RETRY_MS = 60_000;
const PULL_RETRY_MS = 10 * 60_000; // if a model download fails (NAS offline), try again after this
const QUERY_TIMEOUT_MS = Number(process.env.BRAIN_QUERY_TIMEOUT_MS || 10_000);
const EMBED_TIMEOUT_MS = 180_000; // first call loads the model; slow NAS CPUs need time
const MAX_CHARS = 8000;

// Some embedding models are trained with task prefixes and work noticeably better with them.
const PREFIXES = [
  { match: /nomic-embed/, doc: 'search_document: ', query: 'search_query: ' },
  { match: /mxbai-embed/, doc: '', query: 'Represent this sentence for searching relevant passages: ' },
  { match: /embeddinggemma/, doc: 'title: none | text: ', query: 'task: search result | query: ' },
  { match: /snowflake-arctic-embed/, doc: '', query: 'Represent this sentence for searching relevant passages: ' },
];

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const toBlob = (f32) => new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
const fromBlob = (u8) => new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));

export class Semantic {
  constructor(brain, { url, model, minSimilarity, background = true } = {}) {
    this.brain = brain;
    this.db = brain.db;
    this.url = String(url).replace(/\/+$/, '');
    this.model = model || 'nomic-embed-text';
    this.minSimilarity = minSimilarity !== undefined && minSimilarity !== '' ? Number(minSimilarity) : 0.5;
    this.prefix = PREFIXES.find((p) => p.match.test(this.model)) || { doc: '', query: '' };
    this.state = 'idle'; // idle | embedding | pulling | error
    this.lastError = null;
    this.lastPullAt = 0;
    this.pulling = null;
    this.running = null;
    this.cache = null; // { sig, vectors: Map<id, Float32Array> }

    this.db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT NOT NULL, model TEXT NOT NULL, hash TEXT NOT NULL, dim INTEGER NOT NULL,
      vec BLOB NOT NULL, at TEXT NOT NULL, PRIMARY KEY (id, model))`);

    if (background) {
      let t = null;
      brain.onChange = () => { clearTimeout(t); t = setTimeout(() => this.run(), 250); t.unref?.(); };
      this.timer = setInterval(() => this.run(), RETRY_MS);
      this.timer.unref?.();
      setTimeout(() => this.run(), 0).unref?.();
    }
  }

  // ---------- Ollama ----------

  async ollama(path, body, timeoutMs) {
    const res = await fetch(this.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!res.ok) throw Object.assign(new Error(data.error || `Ollama HTTP ${res.status}`), { status: res.status });
    return data;
  }

  async embed(texts, kind, timeoutMs = EMBED_TIMEOUT_MS) {
    const p = kind === 'query' ? this.prefix.query : this.prefix.doc;
    try {
      const data = await this.ollama('/api/embed', {
        model: this.model, input: texts.map((t) => p + t.slice(0, MAX_CHARS)), truncate: true, keep_alive: '30m',
      }, timeoutMs);
      if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) throw new Error('Ollama returned no embeddings');
      return data.embeddings.map(normalize);
    } catch (e) {
      // Only indexing triggers a download; a search must never wait minutes for one.
      if (kind === 'doc' && e.status === 404 && /not found|pull/i.test(e.message)) this.pull();
      throw e;
    }
  }

  // Download the model into Ollama, then embed everything. Retried at most every 10 minutes.
  pull() {
    if (this.pulling || Date.now() - this.lastPullAt < PULL_RETRY_MS) return this.pulling;
    this.lastPullAt = Date.now();
    this.state = 'pulling';
    console.error(`second-brain: pulling embedding model "${this.model}" into Ollama…`);
    this.pulling = this.ollama('/api/pull', { model: this.model, stream: false }, 60 * 60_000)
      .then(() => { console.error(`second-brain: model "${this.model}" ready`); this.state = 'idle'; this.lastError = null; return this.run(); })
      .catch((e) => { this.state = 'error'; this.lastError = `pull failed (retrying in 10 min): ${e.message}`; console.error('second-brain: ' + this.lastError); })
      .finally(() => { this.pulling = null; });
    return this.pulling;
  }

  // ---------- indexing ----------

  docText(r) {
    const tags = JSON.parse(r.tags || '[]');
    return `${r.title}\n${tags.length ? 'Tags: ' + tags.join(', ') + '\n' : ''}\n${r.content}`;
  }

  pending() {
    const have = new Map(this.db.prepare('SELECT id, hash FROM embeddings WHERE model = ?').all(this.model).map((r) => [r.id, r.hash]));
    const out = [];
    for (const r of this.db.prepare('SELECT id, title, tags, content FROM memories').all()) {
      const text = this.docText(r);
      const hash = sha(text);
      if (have.get(r.id) !== hash) out.push({ id: r.id, text, hash });
    }
    return out;
  }

  // Embed every new/changed memory. Safe to call often; concurrent calls share one run.
  run() {
    if (this.running || this.state === 'pulling') return this.running;
    this.running = (async () => {
      // Yield first: with nothing to do, the body would otherwise finish (and clear
      // this.running in `finally`) before this.running is even assigned, leaving a
      // stale promise that blocks every later run.
      await null;
      let done = 0;
      try {
        this.brain.sync();
        const todo = this.pending();
        if (todo.length) this.state = 'embedding';
        for (let i = 0; i < todo.length; i += BATCH) {
          const batch = todo.slice(i, i + BATCH);
          const vecs = await this.embed(batch.map((b) => b.text), 'doc');
          const ins = this.db.prepare('INSERT OR REPLACE INTO embeddings (id, model, hash, dim, vec, at) VALUES (?,?,?,?,?,?)');
          const at = new Date().toISOString();
          this.db.exec('BEGIN');
          try {
            batch.forEach((b, j) => ins.run(b.id, this.model, b.hash, vecs[j].length, toBlob(vecs[j]), at));
            this.db.exec('COMMIT');
          } catch (e) { this.db.exec('ROLLBACK'); throw e; }
          batch.forEach((b, j) => this.cache?.vectors.set(b.id, vecs[j]));
          done += batch.length;
        }
        // Drop vectors for memories that no longer exist.
        this.db.exec('DELETE FROM embeddings WHERE id NOT IN (SELECT id FROM memories)');
        if (this.state !== 'pulling') { this.state = 'idle'; this.lastError = null; }
      } catch (e) {
        if (this.state !== 'pulling') this.state = 'error';
        this.lastError = e.message;
      } finally {
        this.running = null;
      }
      return done;
    })();
    return this.running;
  }

  // ---------- search ----------

  vectors() {
    // Reload when another process (e.g. stdio server on the same vault) has written embeddings.
    const s = this.db.prepare('SELECT count(*) AS n, max(at) AS t FROM embeddings WHERE model = ?').get(this.model);
    const sig = `${s.n}|${s.t}`;
    if (!this.cache || this.cache.sig !== sig) {
      const vectors = new Map();
      for (const r of this.db.prepare('SELECT id, vec FROM embeddings WHERE model = ?').all(this.model)) vectors.set(r.id, fromBlob(r.vec));
      this.cache = { sig, vectors };
    }
    return this.cache.vectors;
  }

  // Nearest memories to a vector, honouring the usual filters.
  nearest(qv, filters = {}, limit = CANDIDATES, excludeId) {
    const { filter, args } = this.brain.filterSql(filters);
    const allowed = this.db.prepare(`SELECT m.id FROM memories m WHERE 1=1${filter}`).all(...args).map((r) => r.id);
    const vecs = this.vectors();
    const scored = [];
    for (const id of allowed) {
      if (id === excludeId) continue;
      const v = vecs.get(id);
      if (!v || v.length !== qv.length) continue;
      const sim = dot(qv, v);
      if (sim >= this.minSimilarity) scored.push({ id, sim });
    }
    return scored.sort((a, b) => b.sim - a.sim).slice(0, limit);
  }

  // Hybrid keyword + meaning search. Same arguments and result shape as Brain.search.
  async recall(opts = {}) {
    const limit = Math.min(100, Math.max(1, Number(opts.limit) || 10));
    if (!String(opts.query || '').trim()) return this.brain.search({ ...opts, limit });

    const kw = this.brain.search({ ...opts, limit: CANDIDATES }).results;
    let vec = [];
    let semantic = 'on';
    try {
      const [qv] = await this.embed([opts.query], 'query', QUERY_TIMEOUT_MS);
      vec = this.nearest(qv, opts);
    } catch (e) {
      semantic = `unavailable (${e.name === 'TimeoutError' ? 'Ollama timed out' : e.message}); keyword results only`;
    }

    const fused = new Map();
    kw.forEach((m, i) => fused.set(m.id, { m, score: 1 / (RRF_K + i + 1), match: 'keyword' }));
    vec.forEach(({ id, sim }, i) => {
      const f = fused.get(id);
      if (f) { f.score += 1 / (RRF_K + i + 1); f.match = 'both'; f.similarity = sim; }
      else fused.set(id, { score: 1 / (RRF_K + i + 1), match: 'meaning', similarity: sim });
    });
    const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
    const results = top.map(([id, f]) => {
      const m = f.m || this.brain.row(this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id), { full: false });
      return { ...m, match: f.match, ...(f.similarity !== undefined ? { similarity: Math.round(f.similarity * 1000) / 1000 } : {}) };
    });
    return { results, semantic };
  }

  // Memories closest in meaning to a stored memory (no Ollama call needed).
  similarTo(id, limit = 8) {
    const v = this.vectors().get(id);
    return v ? this.nearest(v, {}, limit, id) : [];
  }

  status() {
    const embedded = this.db.prepare('SELECT count(*) AS n FROM embeddings WHERE model = ?').get(this.model).n;
    const total = this.db.prepare('SELECT count(*) AS n FROM memories').get().n;
    return { enabled: true, ollama: this.url, model: this.model, state: this.state, embedded, total, lastError: this.lastError };
  }
}

// --- helpers the interfaces use, so they work with or without Ollama ---

export async function recall(brain, opts) {
  return brain.semantic ? brain.semantic.recall(opts) : brain.search(opts);
}

export async function remember(brain, args) {
  const out = brain.remember(args);
  if (brain.semantic) {
    // Check for duplicates by meaning too ("NAS backups nightly" vs "Backups go to the Synology every night").
    const r = await brain.semantic.recall({ query: `${out.memory.title}\n${out.memory.content}`, limit: 4 });
    out.possible_duplicates = r.results.filter((m) => m.id !== out.memory.id && (m.match !== 'keyword' || out.possible_duplicates.some((d) => d.id === m.id))).slice(0, 3);
  }
  return out;
}

export function related(brain, id, limit = 8) {
  const out = brain.related(id, limit);
  if (!brain.semantic) return out;
  const links = out.related.filter((x) => x.why !== 'similar');
  const linkIds = new Set(links.map((x) => x.id));
  const byMeaning = brain.semantic.similarTo(out.memory.id, limit)
    .filter((x) => !linkIds.has(x.id))
    .map(({ id: mid, sim }) => ({ id: mid, title: brain.resolve(mid)?.title, why: 'similar meaning', similarity: Math.round(sim * 1000) / 1000 }));
  const seen = new Set([...linkIds, ...byMeaning.map((x) => x.id)]);
  const byWords = out.related.filter((x) => x.why === 'similar' && !seen.has(x.id));
  out.related = [...links, ...byMeaning, ...byWords].slice(0, links.length + limit);
  return out;
}

export function stats(brain) {
  return { ...brain.stats(), semantic: brain.semantic ? brain.semantic.status() : { enabled: false, hint: 'set OLLAMA_URL to enable meaning-based search' } };
}

export async function context(brain, { topic, limit } = {}) {
  const out = brain.context({ topic, limit });
  if (topic && brain.semantic) out.topic = (await brain.semantic.recall({ query: topic, limit: limit || 15 })).results;
  return out;
}
